import { UniqueConstraintError } from "sequelize"
import { Cart } from "./cart.model.js"
import { CartItem } from "./cartItem.model.js"
import { Product } from "../catalog/product.model.js"
import { Category } from "../catalog/category.model.js"
import { getStoreForManager } from "../stores/store.service.js"
import {
  computeCouponDiscount,
  couponBlockReason,
  findCouponByCode,
} from "../coupons/coupon.service.js"
import {
  lineTaxAmount,
  loadBulkTiers,
  loadPricingContext,
  money,
  priceCatalogLine,
  quoteOrderTotals,
} from "../commerce/pricing.service.js"
import { AppError } from "../../shared/errors/AppError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

function publicCart(cart) {
  const json = cart.toJSON ? cart.toJSON() : cart
  return {
    id: json.id,
    store_id: json.store_id,
    user_id: json.user_id,
    coupon_code: json.coupon_code,
    created_at: json.created_at,
    updated_at: json.updated_at,
  }
}

function publicItem(row) {
  const json = row.toJSON ? row.toJSON() : row
  const product = json.Product
  return {
    id: json.id,
    cart_id: json.cart_id,
    product_id: json.product_id,
    quantity: Number(json.quantity),
    weight: json.weight == null ? null : Number(json.weight),
    product: product
      ? {
          id: product.id,
          title: product.title,
          sku: product.sku,
          selling_price: Number(product.selling_price),
          unit: product.unit,
          image_url: product.image_url,
          is_weight_based: product.is_weight_based,
          web_visible: product.web_visible,
          is_published: product.is_published,
        }
      : null,
  }
}

const itemInclude = { model: Product, include: [Category] }

async function requireCustomer(actor) {
  if (actor.role !== "customer") {
    throw new AppError("Cart is only for web customers", 403)
  }
  if (!actor.store_id) throw new AppError("No store on this account", 400)
}

export async function getOrCreateCart(actor) {
  await requireCustomer(actor)
  const store = await getStoreForManager(actor.store_id)
  const [cart] = await Cart.findOrCreate({
    where: { store_id: store.id, user_id: actor.id },
    defaults: {
      store_id: store.id,
      store_id_int: store.store_id_int,
      user_id: actor.id,
      coupon_code: null,
    },
  })
  return cart
}

export async function loadCartWithItems(actor) {
  const cart = await getOrCreateCart(actor)
  const items = await CartItem.findAll({
    where: { cart_id: cart.id },
    include: [itemInclude],
    order: [["id", "ASC"]],
  })
  return { cart, items }
}

export function cartItemsAsOrderLines(items) {
  return items.map((row) => ({
    product_id: row.product_id,
    quantity: Number(row.quantity),
    weight: row.weight == null ? null : Number(row.weight),
  }))
}

async function quoteCart(store, actor, items, couponCode) {
  if (!items.length) {
    return {
      subtotal: 0,
      discount_amount: 0,
      coupon_discount_amount: 0,
      shipping_fee: 0,
      tax_amount: 0,
      total_amount: 0,
      coupon: null,
    }
  }

  const now = new Date()
  const locationId = actor.location_id || store.default_location_id
  const { offers, taxRates, shippingRule } = await loadPricingContext(store.id, {
    locationId,
    now,
  })
  const productIds = items.map((row) => row.product_id)
  const bulkTiers = await loadBulkTiers(store.id, productIds)
  const tiersByProduct = new Map()
  for (const tier of bulkTiers) {
    const list = tiersByProduct.get(tier.product_id) || []
    list.push(tier)
    tiersByProduct.set(tier.product_id, list)
  }

  const priced = items.map((row) => {
    const product = row.Product
    if (!product) throw new NotFoundError("Product not found")
    const line = priceCatalogLine({
      product,
      quantity: row.quantity,
      weight: row.weight,
      offers,
      bulkTiers: tiersByProduct.get(product.id) || [],
      locationId,
      now,
    })
    line.tax_amount = lineTaxAmount(store, product, product.Category, line.subtotal)
    return line
  })

  const lineSubtotal = money(
    priced.reduce((sum, line) => sum + Number(line.subtotal), 0)
  )

  let coupon = null
  let couponDiscount = 0
  let couponPreview = null
  if (couponCode) {
    coupon = await findCouponByCode(store.id, couponCode)
    if (!coupon) {
      couponPreview = { valid: false, reason: "Coupon not found", discount_amount: 0 }
    } else {
      const reason = couponBlockReason(coupon, {
        order_total: lineSubtotal,
        channel: "web",
        location_id: locationId,
        now,
      })
      if (reason) {
        couponPreview = { valid: false, reason, discount_amount: 0 }
        coupon = null
      } else {
        couponDiscount = computeCouponDiscount(coupon, lineSubtotal)
        couponPreview = { valid: true, reason: null, discount_amount: couponDiscount }
      }
    }
  }

  const totals = quoteOrderTotals({
    lines: priced,
    store,
    channel: "web",
    shippingRule,
    couponDiscount,
    orderDiscount: 0,
    paymentMethod: "cod",
    paymentSplits: null,
    taxRates,
  })

  return {
    subtotal: totals.subtotal,
    discount_amount: totals.discount_amount,
    coupon_discount_amount: totals.coupon_discount_amount,
    shipping_fee: totals.shipping_fee,
    tax_amount: totals.tax_amount,
    total_amount: totals.total_amount,
    coupon: couponPreview,
  }
}

export async function getCartView(actor) {
  const store = await getStoreForManager(actor.store_id)
  const { cart, items } = await loadCartWithItems(actor)
  const quote = await quoteCart(store, actor, items, cart.coupon_code)
  return {
    ...publicCart(cart),
    items: items.map(publicItem),
    quote,
  }
}

export async function setCartCoupon(actor, fields) {
  const cart = await getOrCreateCart(actor)
  const code = fields.coupon_code ? String(fields.coupon_code).trim().toUpperCase() : null
  await cart.update({ coupon_code: code })
  return getCartView(actor)
}

export async function clearCart(actor) {
  const cart = await getOrCreateCart(actor)
  await CartItem.destroy({ where: { cart_id: cart.id } })
  await cart.update({ coupon_code: null })
  return getCartView(actor)
}

async function requireWebProduct(storeId, productId) {
  const product = await Product.findOne({
    where: { id: productId, store_id: storeId },
    include: [Category],
  })
  if (!product) throw new NotFoundError("Product not found")
  if (!product.is_active || !product.is_published || !product.web_visible) {
    throw new AppError("Product is not available on the web store", 400)
  }
  return product
}

export async function addCartItem(actor, fields) {
  const store = await getStoreForManager(actor.store_id)
  const cart = await getOrCreateCart(actor)
  const product = await requireWebProduct(store.id, fields.product_id)
  const quantity = product.is_weight_based
    ? Number(fields.weight ?? fields.quantity)
    : Number(fields.quantity)
  const weight = product.is_weight_based ? quantity : fields.weight

  const existing = await CartItem.findOne({
    where: { cart_id: cart.id, product_id: product.id },
  })
  if (existing) {
    const nextQty = Number(existing.quantity) + quantity
    await existing.update({
      quantity: nextQty,
      weight: product.is_weight_based ? nextQty : weight,
    })
    return getCartView(actor)
  }

  try {
    await CartItem.create({
      cart_id: cart.id,
      product_id: product.id,
      quantity,
      weight,
    })
  } catch (err) {
    if (!(err instanceof UniqueConstraintError)) throw err
    const raced = await CartItem.findOne({
      where: { cart_id: cart.id, product_id: product.id },
    })
    if (raced) {
      const nextQty = Number(raced.quantity) + quantity
      await raced.update({
        quantity: nextQty,
        weight: product.is_weight_based ? nextQty : weight,
      })
    }
  }
  return getCartView(actor)
}

export async function updateCartItem(actor, itemId, fields) {
  const { cart } = await loadCartWithItems(actor)
  const item = await CartItem.findOne({
    where: { id: itemId, cart_id: cart.id },
    include: [itemInclude],
  })
  if (!item) throw new NotFoundError("Cart item not found")
  const product = item.Product
  const quantity =
    product?.is_weight_based && fields.weight != null
      ? Number(fields.weight)
      : Number(fields.quantity)
  await item.update({
    quantity,
    weight: product?.is_weight_based ? quantity : fields.weight ?? item.weight,
  })
  return getCartView(actor)
}

export async function removeCartItem(actor, itemId) {
  const { cart } = await loadCartWithItems(actor)
  const item = await CartItem.findOne({
    where: { id: itemId, cart_id: cart.id },
  })
  if (!item) throw new NotFoundError("Cart item not found")
  await item.destroy()
  return getCartView(actor)
}
