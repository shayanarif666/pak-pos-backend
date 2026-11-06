import { UniqueConstraintError } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { visibilityFromOrderChannel, publicVisibility } from "../../db/channelVisibility.js"
import { ORDER_CHANNEL, PAYMENT_METHOD } from "../../db/enums.js"
import { Order } from "../orders/order.model.js"
import { OrderItem } from "../orders/orderItem.model.js"
import { Payment } from "../payments/payment.model.js"
import { Receipt } from "../payments/receipt.model.js"
import { CouponRedemption } from "../coupons/couponRedemption.model.js"
import { Product } from "../catalog/product.model.js"
import { Category } from "../catalog/category.model.js"
import { Offer } from "../offers/offer.model.js"
import { getStoreForManager } from "../stores/store.service.js"
import { getLocation } from "../locations/location.service.js"
import { Customer } from "../customers/customer.model.js"
import { getCustomer, recordLedgerEntry } from "../customers/customer.service.js"
import {
  computeCouponDiscount,
  couponBlockReason,
  findCouponByCode,
} from "../coupons/coupon.service.js"
import { nextOrderNumber, nextReceiptNumber } from "../../shared/utils/counter.util.js"
import { assertPlan } from "../../shared/utils/plan.util.js"
import { writeAudit } from "../../shared/utils/audit.util.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import {
  applySessionSale,
  requireOpenSession,
} from "../pos/registerSession.service.js"
import { requireApprovedAction } from "../pos/approval.service.js"
import { deductSaleStock } from "./stock.service.js"
import { storeTaxMatcher } from "../taxes/tax.service.js"
import {
  lineTaxBreakdown,
  loadBulkTiers,
  loadPricingContext,
  pricingStore,
  money,
  priceCatalogLine,
  priceCustomLine,
  applyDiscount,
  offerSnapshot,
  quoteOrderTotals,
  splitPaymentTax,
} from "./pricing.service.js"

export function publicOrder(order, extras = {}) {
  const json = order.toJSON ? order.toJSON() : order
  const gross_amount = json.gross_amount == null ? null : Number(json.gross_amount)
  const line_discount_amount =
    json.line_discount_amount == null ? null : Number(json.line_discount_amount)
  const subtotal = Number(json.subtotal)
  const order_discount = Number(json.discount_amount || 0)
  const coupon_discount = Number(json.coupon_discount_amount || 0)
  const tax_amount = Number(json.tax_amount)
  return {
    id: json.id,
    store_id: json.store_id,
    store_number: json.store_id_int ?? json.store_number ?? null,
    location_id: json.location_id,
    location_number: json.location_id_int ?? json.location_number ?? null,
    ...publicVisibility(json),
    is_custom: json.is_custom,
    order_number: json.order_number,
    cashier_id: json.cashier_id,
    customer_id: json.customer_id,
    register_session_id: json.register_session_id,
    client_local_id: json.client_local_id,
    gross_amount: gross_amount ?? subtotal,
    line_discount_amount: line_discount_amount ?? 0,
    subtotal,
    is_order_discounted: json.is_order_discounted,
    order_discount_type: json.order_discount_type,
    discount_amount: order_discount,
    coupon_id: json.coupon_id,
    coupon_code: json.coupon_code,
    coupon_discount_amount: coupon_discount,
    tax_amount,
    sales_tax_rate:
      json.sales_tax_rate == null ? null : Number(json.sales_tax_rate),
    sales_tax_amount: Number(json.sales_tax_amount || 0),
    product_tax_amount: Number(json.product_tax_amount || 0),
    category_tax_amount: Number(json.category_tax_amount || 0),
    payment_gst_amount: Number(json.payment_gst_amount || 0),
    fbr_invoice_enabled: Boolean(json.fbr_invoice_enabled),
    fbr_tax_amount: Number(json.fbr_tax_amount || 0),
    shipping_fee: Number(json.shipping_fee),
    total_amount: Number(json.total_amount),
    cost_total: Number(json.cost_total),
    payment_method: json.payment_method,
    payment_status: json.payment_status,
    order_status: json.order_status,
    void_reason: json.void_reason || null,
    cancel_reason: json.cancel_reason || null,
    amount_paid: Number(json.amount_paid),
    change_due: json.change_due == null ? null : Number(json.change_due),
    shipping_address: json.shipping_address,
    placed_at: json.placed_at,
    ...extras,
    tax: json.tax_breakdown || extras.tax || null,
  }
}

export function publicOrderItem(item) {
  const json = item.toJSON ? item.toJSON() : item
  const quantity = Number(json.quantity)
  const unit_price = Number(json.unit_price)
  const discount_amount = Number(json.discount_amount || 0)
  const after_discount = Number(json.subtotal)
  const tax_amount = Number(json.tax_amount || 0)
  const list_amount = money(unit_price * quantity)
  return {
    id: json.id,
    order_id: json.order_id,
    item_number: json.item_number,
    product_id: json.product_id,
    title: json.title,
    sku: json.sku,
    barcode: json.barcode,
    unit: json.unit,
    is_weight_based: json.is_weight_based,
    weight: json.weight == null ? null : Number(json.weight),
    qty_packs: json.qty_packs == null ? null : Number(json.qty_packs),
    // unit | pack; a pack line: pack_size and pack_price (quantity stays in units).
    sale_unit: json.sale_unit || "unit",
    pack_size: json.pack_size ?? null,
    pack_price: json.pack_price == null ? null : Number(json.pack_price),
    quantity,
    unit_price,
    cost_price: Number(json.cost_price || 0),
    list_amount,
    discount_amount,
    after_discount,
    tax_amount,
    product_tax_amount: Number(json.product_tax_amount || 0),
    category_tax_amount: Number(json.category_tax_amount || 0),
    sales_tax_amount: Number(json.sales_tax_amount || 0),
    product_taxes: Array.isArray(json.product_taxes) ? json.product_taxes : [],
    category_tax_type: json.category_tax_type || null,
    category_tax_value:
      json.category_tax_value == null ? null : Number(json.category_tax_value),
    line_total: money(after_discount + tax_amount),
    refunded_qty: Number(json.refunded_qty || 0),
    remaining_qty: money(Math.max(0, quantity - Number(json.refunded_qty || 0))),
    pricing_source: json.pricing_source || null,
    ...publicVisibility(json),
  }
}

async function loadExisting(storeId, clientLocalId, transaction) {
  if (!clientLocalId) return null
  return Order.findOne({
    where: { store_id: storeId, client_local_id: clientLocalId },
    include: [OrderItem, Payment],
    transaction,
  })
}

async function orderView(order, transaction) {
  const items = order.OrderItems ||
    (await OrderItem.findAll({ where: { order_id: order.id }, transaction }))
  const payments = order.Payments ||
    (await Payment.findAll({ where: { order_id: order.id }, transaction }))
  const receipt =
    order.Receipt ||
    (await Receipt.findOne({ where: { order_id: order.id }, transaction }))
  return {
    order: publicOrder(order),
    items: items.map(publicOrderItem),
    payments,
    receipt,
    idempotent: true,
  }
}

function resolveOrderDiscount(subtotal, input) {
  if (input.order_discount_type && input.order_discount_value != null) {
    return applyDiscount(
      subtotal,
      input.order_discount_type,
      input.order_discount_value
    )
  }
  if (input.discount_amount != null && input.order_discount_type) {
    return money(Math.min(subtotal, Number(input.discount_amount)))
  }
  return 0
}

function normalizeClientLocalId(value) {
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

// Store admins may sell at any branch (dashboard location switcher); everyone else sells
// at their own branch.
function requestedLocationId(actor, store, input) {
  if (actor.role === "store_admin" && input.location_id) return input.location_id
  return actor.location_id || store.default_location_id
}

// ---- POS-priced orders: the till sends every figure; nothing is priced again here ----

const sumOf = (rows, pick) => money(rows.reduce((sum, row) => sum + Number(pick(row) || 0), 0))

/** The pack size of a line sold by the pack (a pack product only). */
function packSaleSize(product, saleUnit) {
  if (saleUnit !== "pack") return null
  const size = Number(product?.pack_size)
  if (!product?.is_pack_product || !(size >= 2)) {
    throw new AppError(`${product?.title || "This product"} is not sold by the pack: send sale_unit unit`, 400)
  }
  return size
}

/**
 * One line as the till priced it, in the shape the order line is saved in. Sold by the pack: the
 * till's qty is packs and its prices one pack's; the line is saved in units (qty × pack size) with
 * the packs, pack size and pack price kept, and the same total.
 */
function posPricedLine(item, product, offersById) {
  const packSize = product ? packSaleSize(product, item.sale_unit) : null
  const packs = packSize ? Number(item.quantity) : null
  const qty = packSize ? packs * packSize : Number(item.quantity)
  const { discount, taxes } = item.priced
  const discount_amount = money(discount?.amount || 0)
  const source = discount?.source || (discount_amount > 0 ? "custom" : product ? "none" : "custom")
  // The discounts the till applied (one or many), as they were at the sale. Only the line's total
  // discount is sent, so one discount keeps that amount; with several, each one's share is null.
  const appliedOffers = (discount?.offer_ids || []).map((id) => offersById.get(id)).filter(Boolean)
  const offer = appliedOffers[0] || null
  // A store tax (Taxes page) is saved with the product's own taxes.
  const ofLevel = (level) =>
    taxes.filter((tax) => tax.level === level || (level === "product" && tax.level === "store"))
  const categoryTax = ofLevel("category")[0] || null
  const salePrice = money(item.unit_price)
  const unit_price = packSize ? money(salePrice / packSize) : salePrice
  const snapshot = (amount) => ({ name: null, type: null, value: null, amount })
  return {
    product_id: product?.id || null,
    title: item.title || product?.title,
    custom_category: product ? null : item.custom_category || null,
    category_id: product ? product.Category?.id || product.category_id || null : null,
    category_name: product?.Category?.name || null,
    category_tax_name: categoryTax?.name || null,
    sku: product?.sku || null,
    barcode: product?.barcode || null,
    unit: product?.unit || null,
    is_weight_based: Boolean(product?.is_weight_based),
    weight: product?.is_weight_based && !packSize ? qty : item.weight ?? null,
    qty_packs: packSize
      ? packs
      : product?.is_pack_product && product.pack_size ? Math.floor(qty / Number(product.pack_size)) : null,
    sale_unit: packSize ? "pack" : "unit",
    pack_size: packSize,
    pack_price: packSize ? salePrice : null,
    quantity: qty,
    unit_price,
    // A pack line's cost_price is one pack's.
    cost_price: money(
      item.cost_price != null ? (packSize ? Number(item.cost_price) / packSize : item.cost_price) : product?.cost_price ?? 0
    ),
    discount_amount,
    discount_source: source,
    offer_id: offer?.id || null,
    offers: appliedOffers.map((row) => ({
      ...offerSnapshot(row, null, 0),
      amount: appliedOffers.length === 1 ? discount_amount : null,
    })),
    product_discount: source === "product" ? snapshot(discount_amount) : null,
    category_discount: source === "category" ? snapshot(discount_amount) : null,
    free_qty: discount?.free_qty || 0,
    // The till's own figures: price × qty as it sold them (per pack on a pack line).
    subtotal: money(salePrice * Number(item.quantity) - discount_amount),
    tax_amount: sumOf(taxes, (tax) => tax.amount),
    product_tax_amount: sumOf(ofLevel("product"), (tax) => tax.amount),
    category_tax_amount: sumOf(ofLevel("category"), (tax) => tax.amount),
    sales_tax_amount: sumOf(ofLevel("sales"), (tax) => tax.amount),
    product_taxes: ofLevel("product").map((tax) => ({ name: tax.name, type: tax.type, value: tax.rate, amount: money(tax.amount) })),
    category_tax_type: categoryTax ? categoryTax.type : null,
    category_tax_value: categoryTax?.rate ?? null,
    pricing_source: "pos",
  }
}

/** The order's totals and payment rows from the till's figures (sums of what it sent). */
function posPricedTotals({ lines, store, input, orderDiscount, couponDiscount }) {
  const splits = (input.payments || []).map((row) => {
    // The payment's surcharge (surcharge_amount; tax_amount from older tills).
    const gst_amount = money(row.surcharge_amount ?? row.tax_amount ?? 0)
    const amount = money(row.amount ?? (row.bill_share != null ? Number(row.bill_share) + gst_amount : row.paid || 0))
    return {
      method: row.method,
      bill_share: money(amount - gst_amount),
      gst_percent: row.surcharge_type === "fixed" ? 0 : row.surcharge_value ?? row.tax_rate ?? 0,
      gst_amount,
      amount,
      paid: money(row.paid ?? amount),
      change: row.method === "cash" ? money(Math.max(0, Number(row.paid ?? amount) - amount)) : 0,
      transaction_id: row.transaction_id || null,
    }
  })
  const subtotal = sumOf(lines, (line) => line.subtotal)
  const line_tax = sumOf(lines, (line) => line.tax_amount)
  const shipping_fee = money(input.shipping_fee || 0)
  const gst = sumOf(splits, (row) => row.gst_amount)
  const salesRate = input.items.flatMap((item) => item.priced.taxes).find((tax) => tax.level === "sales")?.rate
  const tax_amount = money(line_tax + gst)
  const totals = {
    gross_amount: sumOf(lines, (line) => Number(line.unit_price) * Number(line.quantity)),
    line_discount_amount: sumOf(lines, (line) => line.discount_amount),
    subtotal,
    discount_amount: money(orderDiscount),
    coupon_discount_amount: money(couponDiscount),
    shipping_fee,
    line_tax,
    product_tax_amount: sumOf(lines, (line) => line.product_tax_amount),
    category_tax_amount: sumOf(lines, (line) => line.category_tax_amount),
    sales_tax_amount: sumOf(lines, (line) => line.sales_tax_amount),
    sales_tax_rate: salesRate ?? (store.sales_tax_rate == null ? null : Number(store.sales_tax_rate)),
    fbr_invoice_enabled: Boolean(store.fbr_invoice_enabled),
    fbr_tax_amount: store.fbr_invoice_enabled ? tax_amount : 0,
    gst,
    payment_gst_amount: gst,
    payment_gst_splits: splits.map((row) => ({
      method: row.method,
      amount: row.amount,
      gst_percent: row.gst_percent,
      gst_amount: row.gst_amount,
    })),
    tax_amount,
    // The till's total wins; without one it is the sum of what it sent.
    total_amount: money(
      input.total_amount ?? subtotal - orderDiscount - couponDiscount + line_tax + shipping_fee + gst
    ),
    cost_total: sumOf(lines, (line) => Number(line.cost_price) * Number(line.quantity)),
  }
  return { totals, split: { splits, gst } }
}

const OFFLINE_AFTER_MS = 2 * 60 * 1000
const MAX_OFFLINE_AGE_MS = 30 * 24 * 60 * 60 * 1000

/** Offline POS sales keep the time they were rung up, not the time they reached the server. */
function resolvePlacedAt(input, now) {
  if (!input.placed_at) return now
  const at = new Date(input.placed_at)
  if (Number.isNaN(at.getTime())) throw new AppError("placed_at is not a valid date", 400)
  if (at.getTime() > now.getTime() + 5 * 60 * 1000) {
    throw new AppError("placed_at cannot be in the future", 400)
  }
  if (now.getTime() - at.getTime() > MAX_OFFLINE_AGE_MS) {
    throw new AppError("Offline sale is older than 30 days", 400)
  }
  return at
}

export async function createOrder(actor, input) {
  const channel = String(input.channel || "pos")
  if (!ORDER_CHANNEL.includes(channel)) {
    throw new AppError("channel must be web or pos", 400)
  }

  const items = Array.isArray(input.items) ? input.items : []
  if (!items.length) throw new AppError("items are required", 400)

  const is_custom = Boolean(input.is_custom)
  const client_local_id = normalizeClientLocalId(input.client_local_id)
  // Priced with the Taxes page taxes and payment surcharges (not the store's old tax settings).
  const store = pricingStore(await getStoreForManager(actor.store_id))
  const syncedAt = new Date()
  const placedAt = resolvePlacedAt({ ...input, client_local_id }, syncedAt)
  const offline =
    channel === "pos" &&
    (Boolean(input.offline) || syncedAt.getTime() - placedAt.getTime() > OFFLINE_AFTER_MS)
  // Offline sync used to be a Package 2 / 3 feature; /orders/bulk is now the POS's only way to
  // send sales, so it is open on every plan (offline only marks synced_at).
  // if (offline) await assertPlan(store, "offline_enabled")

  return sequelize.transaction(async (transaction) => {
    const existing = await loadExisting(store.id, client_local_id, transaction)
    if (existing) return { ...(await orderView(existing, transaction)), idempotent: true }

    let session = null
    if (channel === "pos") {
      session = await requireOpenSession(
        store.id,
        {
          locationId: requestedLocationId(actor, store, input),
          deviceId: input.device_id || actor.device_id,
          sessionId: input.register_session_id,
          cashierId: actor.id,
          actorRole: actor.role,
          placedAt,
          offline,
        },
        { transaction }
      )
    }

    const locationId = session?.location_id || requestedLocationId(actor, store, input)
    if (!is_custom && !locationId) {
      throw new AppError("location_id is required to deduct stock", 400)
    }
    if (channel === "pos" && !locationId) {
      throw new AppError("location_id is required for POS sales", 400)
    }
    const location = locationId
      ? await getLocation(store.id, locationId)
      : null

    const now = placedAt
    const { offers, taxRates, shippingRule } = await loadPricingContext(store.id, {
      locationId: location?.id,
      now,
    })

    const productIds = items
      .map((item) => item.product_id)
      .filter(Boolean)
    const products = productIds.length
      ? await Product.findAll({
          where: { id: productIds, store_id: store.id },
          include: [Category],
          transaction,
        })
      : []
    // The Taxes page taxes of each product (a variant: its own and its parent's).
    const taxesFor = await storeTaxMatcher(store.id)
    for (const product of products) product.store_taxes = taxesFor(product, product.parent_product_id)
    const productMap = new Map(products.map((row) => [row.id, row]))
    const bulkTiers = await loadBulkTiers(store.id, productIds)
    const tiersByProduct = new Map()
    for (const tier of bulkTiers) {
      const list = tiersByProduct.get(tier.product_id) || []
      list.push(tier)
      tiersByProduct.set(tier.product_id, list)
    }

    const offerIds = input.precomputed
      ? [...new Set(items.flatMap((item) => item.priced?.discount?.offer_ids || []).filter(Boolean))]
      : []
    const offersById = new Map(
      (offerIds.length ? await Offer.findAll({ where: { id: offerIds, store_id: store.id }, transaction, paranoid: false }) : []).map(
        (row) => [row.id, row]
      )
    )

    const priced = input.precomputed
      ? items.map((item) => {
          if (!item.product_id) return posPricedLine(item, null, offersById)
          const product = productMap.get(item.product_id)
          if (!product) throw new NotFoundError("Product not found")
          if (!product.is_active) throw new AppError("Product is not active", 400)
          if (product.has_variants) throw new AppError(`${product.title} has variants: sell one of them`, 400)
          return posPricedLine(item, product, offersById)
        })
      : items.map((item) => {
      if (is_custom && !item.product_id) {
        if (!item.title) throw new AppError("Custom lines require a title", 400)
        if (item.unit_price == null) {
          throw new AppError("Custom lines require unit_price", 400)
        }
        const line = priceCustomLine(item)
        line.custom_category = item.custom_category || null
        Object.assign(
          line,
          input.tax_exempt
            ? lineTaxBreakdown({ ...store, charge_tax_on_sales: false }, null, null, 0)
            : lineTaxBreakdown(store, null, null, line.subtotal, line.quantity)
        )
        return line
      }
      const product = productMap.get(item.product_id)
      if (!product) throw new NotFoundError("Product not found")
      if (!product.is_active) throw new AppError("Product is not active", 400)
      if (product.has_variants) throw new AppError(`${product.title} has variants: sell one of them`, 400)
      packSaleSize(product, item.sale_unit)
      const line = priceCatalogLine({
        product,
        quantity: item.quantity,
        weight: item.weight,
        // pack: quantity is packs, priced by the pack.
        saleUnit: item.sale_unit || "unit",
        // offer_exempt (order or line): no offer; product / category discounts still apply.
        offers: input.offer_exempt || item.offer_exempt ? [] : offers,
        bulkTiers: tiersByProduct.get(product.id) || [],
        locationId: location?.id,
        now,
      })
      Object.assign(
        line,
        input.tax_exempt
          ? lineTaxBreakdown({ ...store, charge_tax_on_sales: false }, null, null, 0)
          : lineTaxBreakdown(store, product, product.Category, line.subtotal, line.quantity)
      )
      line.category_id = product.Category?.id || product.category_id || null
      line.category_name = product.Category?.name || null
      line.category_tax_name = product.Category?.tax_name || null
      return line
    })

    const lineSubtotal = money(
      priced.reduce((sum, line) => sum + Number(line.subtotal), 0)
    )
    const orderDiscount = input.precomputed
      ? money(input.order_discount?.amount || 0)
      : resolveOrderDiscount(lineSubtotal, input)
    // A manual order discount is a discount_override: cashiers need a manager's approval.
    if (orderDiscount > 0 && actor.role === "cashier") {
      await requireApprovedAction({
        store,
        actor,
        type: "discount_override",
        approvalRequestId: input.approval_request_id,
      })
    }
    if (!input.precomputed && !input.tax_exempt && orderDiscount > 0 && lineSubtotal > 0) {
      const taxableShare = money((lineSubtotal - orderDiscount) / lineSubtotal)
      for (const line of priced) {
        if (!line.product_id) {
          Object.assign(
            line,
            lineTaxBreakdown(
              store,
              null,
              null,
              money(Number(line.subtotal) * taxableShare),
              line.quantity
            )
          )
          continue
        }
        const product = productMap.get(line.product_id)
        Object.assign(
          line,
          lineTaxBreakdown(
            store,
            product,
            product?.Category,
            money(Number(line.subtotal) * taxableShare),
            line.quantity
          )
        )
      }
    }

    let coupon = null
    let couponDiscount = 0
    if (input.precomputed) {
      // The till's coupon amount is kept; the code (if any) links the coupon and counts the use.
      couponDiscount = money(input.coupon?.amount || 0)
      if (input.coupon?.code) {
        coupon = await findCouponByCode(store.id, input.coupon.code)
        if (!coupon) throw new AppError("Coupon not found", 400)
      }
    } else if (input.coupon_code) {
      coupon = await findCouponByCode(store.id, input.coupon_code)
      if (!coupon) throw new AppError("Coupon not found", 400)
      const reason = couponBlockReason(coupon, {
        order_total: money(lineSubtotal - orderDiscount),
        channel,
        location_id: location?.id,
        now,
      })
      if (reason) throw new AppError(reason, 400)
      couponDiscount = computeCouponDiscount(
        coupon,
        money(lineSubtotal - orderDiscount)
      )
    }

    let paymentSplits = Array.isArray(input.payments)
      ? input.payments.filter((row) => row && row.method)
      : []
    // One method without payments[]: amount_paid is what was handed over.
    if (!paymentSplits.length && channel === "pos" && input.amount_paid != null && input.payment_method) {
      paymentSplits = [{ method: input.payment_method, paid: input.amount_paid }]
    }
    for (const row of paymentSplits) {
      if (!PAYMENT_METHOD.includes(row.method) || row.method === "mixed") {
        throw new AppError("Invalid payment method", 400)
      }
    }

    const payment_method =
      paymentSplits.length > 1
        ? "mixed"
        : paymentSplits[0]?.method || input.payment_method
    if (!PAYMENT_METHOD.includes(payment_method)) {
      throw new AppError("payment_method is required", 400)
    }

    let totals
    let split
    if (input.precomputed) {
      ;({ totals, split } = posPricedTotals({ lines: priced, store, input, orderDiscount, couponDiscount }))
    } else {
    // The bill before payment tax, then each payment's tax on its own share of it.
    const preGst = quoteOrderTotals({
      lines: priced,
      store,
      channel,
      shippingRule,
      couponDiscount,
      orderDiscount,
      paymentMethod: null,
      paymentSplits: null,
      taxRates,
      taxExempt: Boolean(input.tax_exempt),
    })
    split = splitPaymentTax({
      store,
      taxRates,
      preGst: preGst.total_amount,
      payments: paymentSplits,
      paymentMethod: payment_method,
      taxExempt: Boolean(input.tax_exempt),
    })
    totals = {
      ...preGst,
      gst: split.gst,
      payment_gst_amount: split.gst,
      payment_gst_splits: split.splits,
      tax_amount: money(preGst.line_tax + split.gst),
      fbr_tax_amount: preGst.fbr_invoice_enabled && !input.tax_exempt ? money(preGst.line_tax + split.gst) : 0,
      total_amount: money(preGst.total_amount + split.gst),
    }
    }
    const isWeb = channel === "web"

    let customer = null
    if (input.customer_id) {
      customer = await getCustomer(store.id, input.customer_id)
    } else if (actor.role === "customer") {
      customer = await Customer.findOne({
        where: { store_id: store.id, user_id: actor.id },
        transaction,
      })
      if (!customer) throw new AppError("Customer profile not found", 400)
    }

    const order_number = await nextOrderNumber(store.id, transaction)
    const cashier_id = ["cashier", "manager", "store_admin"].includes(actor.role)
      ? actor.id
      : null

    let order
    try {
      order = await Order.create(
        {
          store_id: store.id,
          store_id_int: store.store_id_int,
          location_id: location?.id || null,
          location_id_int: location?.location_id_int || null,
          ...visibilityFromOrderChannel(channel),
          is_custom,
          offer_exempt: Boolean(input.offer_exempt),
          order_number,
          cashier_id,
          customer_id: customer?.id || null,
          register_session_id: session?.id || null,
          client_local_id,
          gross_amount: totals.gross_amount,
          line_discount_amount: totals.line_discount_amount,
          subtotal: totals.subtotal,
          is_order_discounted: orderDiscount > 0,
          order_discount_type:
            orderDiscount > 0 ? (input.precomputed ? input.order_discount?.type : input.order_discount_type) : null,
          discount_amount: totals.discount_amount,
          coupon_id: coupon?.id || null,
          coupon_code: coupon?.code || null,
          coupon_discount_amount: totals.coupon_discount_amount,
          tax_amount: totals.tax_amount,
          sales_tax_rate: totals.sales_tax_rate,
          sales_tax_amount: totals.sales_tax_amount,
          product_tax_amount: totals.product_tax_amount,
          category_tax_amount: totals.category_tax_amount,
          payment_gst_amount: totals.payment_gst_amount,
          fbr_invoice_enabled: totals.fbr_invoice_enabled,
          fbr_tax_amount: totals.fbr_tax_amount,
          tax_breakdown: {
            sales_tax_rate: totals.sales_tax_rate,
            sales_tax_amount: totals.sales_tax_amount,
            product_tax_amount: totals.product_tax_amount,
            category_tax_amount: totals.category_tax_amount,
            payment_gst_amount: totals.payment_gst_amount,
            payment_gst: totals.payment_gst_splits,
            fbr_invoice_enabled: totals.fbr_invoice_enabled,
            fbr_tax_amount: totals.fbr_tax_amount,
            total: totals.tax_amount,
          },
          shipping_fee: totals.shipping_fee,
          total_amount: totals.total_amount,
          cost_total: totals.cost_total,
          payment_method,
          // Web (COD / wallet) is collected later; it turns paid/completed on payment confirm.
          payment_status: isWeb ? "pending" : "paid",
          shipping_address: channel === "web" ? input.shipping_address || null : null,
          order_status: isWeb ? "pending" : "completed",
          amount_paid: 0,
          change_due: null,
          placed_at: placedAt,
          synced_at: offline ? syncedAt : null,
        },
        { transaction }
      )
    } catch (err) {
      if (err instanceof UniqueConstraintError && client_local_id) {
        const replay = await loadExisting(store.id, client_local_id, transaction)
        if (replay) return { ...(await orderView(replay, transaction)), idempotent: true }
        throw new ConflictError("Duplicate order")
      }
      throw err
    }

    const savedItems = await OrderItem.bulkCreate(
      priced.map((line, idx) => ({
        order_id: order.id,
        item_number: idx + 1,
        ...visibilityFromOrderChannel(channel),
        product_id: line.product_id,
        title: line.title,
        custom_category: line.custom_category || null,
        category_id: line.category_id || null,
        category_name: line.category_name || null,
        sku: line.sku,
        barcode: line.barcode,
        unit: line.unit,
        is_weight_based: line.is_weight_based,
        weight: line.weight,
        qty_packs: line.qty_packs,
        sale_unit: line.sale_unit || "unit",
        pack_size: line.pack_size ?? null,
        pack_price: line.pack_price ?? null,
        unit_price: line.unit_price,
        cost_price: line.cost_price,
        quantity: line.quantity,
        discount_amount: line.discount_amount,
        discount_source: line.discount_source || (line.product_id ? "none" : "custom"),
        offer_id: line.offer_id || null,
        offers: line.offers || [],
        product_discount: line.product_discount || null,
        category_discount: line.category_discount || null,
        free_qty: line.free_qty || 0,
        tax_amount: line.tax_amount,
        product_tax_amount: line.product_tax_amount || 0,
        category_tax_amount: line.category_tax_amount || 0,
        sales_tax_amount: line.sales_tax_amount || 0,
        product_taxes: line.product_taxes || [],
        category_tax_type: line.category_tax_type || null,
        category_tax_value: line.category_tax_value ?? null,
        category_tax_name: line.category_tax_name || null,
        subtotal: line.subtotal,
      })),
      { transaction }
    )

    for (const line of priced) {
      if (!line.product_id) continue
      await deductSaleStock(
        {
          store,
          location,
          productId: line.product_id,
          qty: line.quantity,
          staffId: cashier_id,
          orderId: order.id,
          isCustom: is_custom,
        },
        { transaction }
      )
    }

    // Each payment row: amount = its share of the bill + its payment tax; paid = handed over.
    const plannedPayments = split.splits.filter((row) => Number(row.amount) > 0)
    const collected = money(plannedPayments.reduce((sum, row) => sum + Number(row.amount), 0))
    const handedOver = money(plannedPayments.reduce((sum, row) => sum + Number(row.paid), 0))
    const tendered = money(Math.max(handedOver, input.amount_paid ?? 0))
    let creditAmount = money(totals.total_amount - collected)
    if (creditAmount < 0) creditAmount = 0
    if (creditAmount > 0 && !customer) {
      throw new AppError("A customer is required for credit / udhaar", 400)
    }

    const payments = []
    for (const row of plannedPayments) {
      const amount = money(row.amount)
      const tax_amount = money(row.gst_amount)
      const payment = await Payment.create(
        {
          store_id: store.id,
          store_id_int: store.store_id_int,
          location_id: location?.id || null,
          location_id_int: location?.location_id_int || null,
          order_id: order.id,
          ...visibilityFromOrderChannel(channel),
          method: row.method,
          amount,
          tax_amount,
          currency: store.currency || "PKR",
          status: isWeb ? "initiated" : "success",
          // When the money changed hands: the sale's time (an offline sale syncs later).
          paid_at: isWeb ? null : placedAt,
          // The till's card / wallet reference, if sent; transaction_number is set by the model.
          gateway_transaction_id: row.transaction_id || null,
        },
        { transaction }
      )
      payments.push(payment)
    }

    if (creditAmount > 0) {
      await recordLedgerEntry(
        customer,
        {
          entry_type: "debit",
          amount: creditAmount,
          order_id: order.id,
          created_by: actor.id,
          note: `Order #${order_number}`,
        },
        { transaction }
      )
    }

    const amount_paid = isWeb ? 0 : tendered
    const change_due =
      amount_paid > totals.total_amount
        ? money(amount_paid - totals.total_amount)
        : 0

    const receipt_number = await nextReceiptNumber(store.id, transaction)
    const receipt = await Receipt.create(
      {
        store_id: store.id,
        store_id_int: store.store_id_int,
        location_id: location?.id || null,
        location_id_int: location?.location_id_int || null,
        order_id: order.id,
        ...visibilityFromOrderChannel(channel),
        payment_id: payments[0]?.id || null,
        receipt_number,
        cashier_id,
        subtotal: totals.subtotal,
        discount_amount: money(totals.discount_amount + totals.coupon_discount_amount),
        tax_amount: totals.tax_amount,
        shipping_fee: totals.shipping_fee,
        total_amount: totals.total_amount,
        // The receipt is dated when the sale happened, not when an offline sale synced.
        issued_at: placedAt,
      },
      { transaction }
    )

    if (coupon && couponDiscount > 0) {
      await CouponRedemption.create(
        {
          store_id: store.id,
          coupon_id: coupon.id,
          order_id: order.id,
          user_id: actor.role === "customer" ? actor.id : null,
          amount: couponDiscount,
        },
        { transaction }
      )
      await coupon.update(
        { used_count: Number(coupon.used_count) + 1 },
        { transaction }
      )
    }

    await order.update(
      {
        amount_paid,
        change_due,
        // Paid less than the total (udhaar): partial; remaining_amount = what is still owed.
        ...(!isWeb && creditAmount > 0 ? { payment_status: "partial" } : {}),
      },
      { transaction }
    )

    if (session) {
      await applySessionSale(
        session,
        { payments, total: totals.total_amount },
        { transaction }
      )
    }

    await writeAudit({
      action: "sale",
      entity_type: "orders",
      entity_id: order.id,
      store_id: store.id,
      store_id_int: store.store_id_int,
      location_id: location?.id || null,
      location_id_int: location?.location_id_int || null,
      user_id: actor.id,
      channel,
      note: `#${order_number}`,
      after_data: {
        order_number,
        total_amount: totals.total_amount,
        payment_method,
        channel,
      },
    })

    const cashier = actor
      ? {
          id: actor.id,
          name: actor.name,
          email: actor.email,
          phone: actor.phone,
          role: actor.role,
        }
      : null
    const customerLite = customer
      ? {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
        }
      : null

    return {
      order: publicOrder(order, {
        amount_paid,
        change_due,
        cashier,
        customer: customerLite,
      }),
      items: savedItems.map((row, index) =>
        publicOrderItem({
          ...(row.toJSON ? row.toJSON() : row),
          pricing_source: priced[index]?.pricing_source || null,
        })
      ),
      payments,
      receipt,
      customer: customerLite,
      idempotent: false,
    }
  })
}
