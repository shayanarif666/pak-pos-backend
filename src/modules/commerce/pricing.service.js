import { Op } from "sequelize"
import { Offer } from "../offers/offer.model.js"
import { OfferTarget } from "../offers/offerTarget.model.js"
import { ProductBulkTier } from "../catalog/productBulkTier.model.js"
import { PaymentMethodTaxRate } from "../stores/paymentMethodTaxRate.model.js"
import { getShipping } from "../stores/store.service.js"

export function money(value) {
  return Number(Number(value || 0).toFixed(2))
}

export function applyDiscount(base, type, value) {
  const amount = Number(value || 0)
  if (!type || amount <= 0) return 0
  if (type === "percentage") return money(Math.min(base, (base * amount) / 100))
  return money(Math.min(base, amount))
}

function categoryOf(product, category) {
  return category || product?.Category || product?.category || null
}

export function productUnitDiscount(product, category) {
  const list = Number(product.selling_price || 0)
  if (product.has_product_discount) {
    return applyDiscount(list, product.discount_type, product.discount_value)
  }
  const cat = categoryOf(product, category)
  if (cat?.discount_type && cat.discount_value != null) {
    return applyDiscount(list, cat.discount_type, cat.discount_value)
  }
  return 0
}

export function priceAfterProductDiscount(product, category) {
  return money(Number(product.selling_price || 0) - productUnitDiscount(product, category))
}

export function bogoFreeQty(qty, buy_qty, get_qty) {
  const buy = Number(buy_qty)
  const get = Number(get_qty)
  if (!buy || !get || buy < 1 || get < 1) return 0
  const group = buy + get
  return Math.floor(Number(qty) / group) * get
}

function targetMatches(target, product) {
  if (target.product_id && target.product_id === product.id) return true
  if (target.category_id && target.category_id === product.category_id) return true
  return false
}

export function offerIsLive(offer, { locationId, now = new Date() } = {}) {
  if (!offer.is_active) return false
  if (offer.location_id && offer.location_id !== locationId) return false
  if (offer.start_at && now < new Date(offer.start_at)) return false
  if (offer.end_at && now > new Date(offer.end_at)) return false
  return true
}

function matchingTargets(offer, product) {
  return (offer.OfferTargets || offer.targets || []).filter((target) =>
    targetMatches(target, product)
  )
}

function offerUnitAfterDiscount(base, offer, target) {
  if (offer.type === "flash_sale" && target?.promo_price != null) {
    return money(Math.min(base, Number(target.promo_price)))
  }
  if (offer.discount_type && offer.discount_value != null) {
    return money(base - applyDiscount(base, offer.discount_type, offer.discount_value))
  }
  return base
}

function bestBulkUnit(base, qty, productTiers, bulkOffers, product) {
  let best = { unit: base, source: null, savings: 0 }

  if (productTiers?.length) {
    const eligible = productTiers
      .filter((tier) => Number(qty) >= Number(tier.min_qty))
      .sort((a, b) => Number(b.min_qty) - Number(a.min_qty))
    if (eligible[0]) {
      const unit = money(
        base - applyDiscount(base, eligible[0].discount_type, eligible[0].discount_value)
      )
      const savings = money((base - unit) * Number(qty))
      if (savings > best.savings) {
        best = { unit, source: "product_bulk", savings, tier: eligible[0] }
      }
    }
  }

  for (const offer of bulkOffers || []) {
    if (offer.min_qty != null && Number(qty) < Number(offer.min_qty)) continue
    const target = matchingTargets(offer, product)[0]
    const unit = offerUnitAfterDiscount(base, offer, target)
    const savings = money((base - unit) * Number(qty))
    if (savings > best.savings) {
      best = { unit, source: "offer_bulk", savings, offer }
    }
  }

  return best
}

export function priceCatalogLine({
  product,
  quantity,
  weight,
  offers = [],
  bulkTiers = [],
  locationId,
  now = new Date(),
}) {
  const qty =
    product.is_weight_based && weight != null ? Number(weight) : Number(quantity)
  if (!qty || qty <= 0) {
    throw new Error("quantity must be > 0")
  }

  const list = money(product.selling_price)
  const afterProduct = priceAfterProductDiscount(product, product.Category || product.category)
  const live = offers.filter((offer) => offerIsLive(offer, { locationId, now }))
  const matching = live.filter((offer) => matchingTargets(offer, product).length)
  const catalogSource =
    product.has_product_discount
      ? "product"
      : product.Category?.discount_type || product.category?.discount_type
        ? "category"
        : "list"

  const candidates = [
    {
      unit: afterProduct,
      discount: money((list - afterProduct) * qty),
      offer_id: null,
      source: catalogSource,
    },
  ]

  for (const offer of matching.filter((row) =>
    ["flash_sale", "promotional"].includes(row.type)
  )) {
    const target = matchingTargets(offer, product)[0]
    const unit = offerUnitAfterDiscount(list, offer, target)
    candidates.push({
      unit,
      discount: money((list - unit) * qty),
      offer_id: offer.id,
      source: offer.type,
    })
  }

  const bulkOffers = matching.filter((row) => row.type === "bulk_discount")
  const tiers = product.has_bulk_discount ? bulkTiers : []
  const bulk = bestBulkUnit(list, qty, tiers, bulkOffers, product)
  if (bulk.source) {
    candidates.push({
      unit: bulk.unit,
      discount: money((list - bulk.unit) * qty),
      offer_id: bulk.offer?.id || null,
      source: bulk.source,
    })
  }

  for (const offer of matching.filter((row) => row.type === "bogo")) {
    const free = bogoFreeQty(qty, offer.buy_qty, offer.get_qty)
    const paidQty = qty - free
    const line = money(list * paidQty)
    const discount = money(list * qty - line)
    candidates.push({
      unit: list,
      discount,
      offer_id: offer.id,
      source: "bogo",
      free_qty: free,
    })
  }

  candidates.sort((a, b) => b.discount - a.discount || a.unit - b.unit)
  const best = candidates[0]
  const line_subtotal = money(list * qty - best.discount)

  return {
    product_id: product.id,
    title: product.title,
    sku: product.sku,
    barcode: product.barcode,
    unit: product.unit,
    is_weight_based: Boolean(product.is_weight_based),
    weight: product.is_weight_based ? qty : null,
    qty_packs:
      product.is_pack_product && product.pack_size
        ? Math.floor(qty / Number(product.pack_size))
        : null,
    quantity: qty,
    unit_price: list,
    cost_price: money(product.cost_price),
    discount_amount: best.discount,
    subtotal: line_subtotal,
    offer_id: best.offer_id,
    pricing_source: best.source,
  }
}

export function priceCustomLine(item) {
  const qty = Number(item.quantity)
  if (!qty || qty <= 0) throw new Error("quantity must be > 0")
  const unit_price = money(item.unit_price)
  const discount_amount = money(item.discount_amount || 0)
  return {
    product_id: null,
    title: String(item.title || "").trim(),
    sku: item.sku || null,
    barcode: item.barcode || null,
    unit: item.unit || null,
    is_weight_based: false,
    weight: null,
    qty_packs: null,
    quantity: qty,
    unit_price,
    cost_price: money(item.cost_price || 0),
    discount_amount,
    subtotal: money(unit_price * qty - discount_amount),
    offer_id: null,
    pricing_source: "custom",
  }
}

export function lineTaxAmount(store, product, category, taxable) {
  if (!store.charge_tax_on_sales) return 0
  if (product?.tax_type && product.tax_value != null) {
    return applyDiscount(taxable, product.tax_type, product.tax_value)
  }
  if (category?.tax_type && category.tax_value != null) {
    return applyDiscount(taxable, category.tax_type, category.tax_value)
  }
  if (store.default_tax_rate != null) {
    return applyDiscount(taxable, "percentage", store.default_tax_rate)
  }
  return 0
}

export function quoteShipping(channel, rule, afterDiscounts) {
  if (channel !== "web") return 0
  if (!rule) return 0
  const flat = money(rule.flat_fee)
  const freeOver = rule.free_over_amount == null ? null : Number(rule.free_over_amount)
  if (freeOver != null && Number(afterDiscounts) >= freeOver) return 0
  return flat
}

export function paymentGst(store, rates, method, taxableShare) {
  if (!store.charge_tax_on_sales || !method || method === "mixed") return 0
  const row = (rates || []).find((rate) => rate.payment_method === method)
  if (!row) return 0
  return applyDiscount(taxableShare, "percentage", row.gst_percent)
}

export function quoteOrderTotals({
  lines,
  store,
  channel,
  shippingRule,
  couponDiscount = 0,
  orderDiscount = 0,
  paymentMethod,
  paymentSplits,
  taxRates,
  taxExempt = false,
}) {
  const gross_amount = money(
    lines.reduce((sum, line) => sum + Number(line.unit_price) * Number(line.quantity), 0)
  )
  const line_discount_amount = money(
    lines.reduce((sum, line) => sum + Number(line.discount_amount || 0), 0)
  )
  const subtotal = money(lines.reduce((sum, line) => sum + Number(line.subtotal), 0))
  const line_tax = taxExempt
    ? 0
    : money(lines.reduce((sum, line) => sum + Number(line.tax_amount || 0), 0))
  const goods = money(Math.max(0, subtotal - orderDiscount - couponDiscount))
  const shipping_fee = quoteShipping(channel, shippingRule, goods)
  const pre_gst = money(goods + line_tax + shipping_fee)

  let gst = 0
  if (taxExempt || channel === "pos") {
    gst = 0
  } else if (paymentSplits?.length) {
    const splitSum = paymentSplits.reduce((sum, row) => sum + Number(row.amount), 0)
    if (splitSum > 0) {
      gst = money(
        paymentSplits.reduce((sum, row) => {
          const share = (Number(row.amount) / splitSum) * pre_gst
          return sum + paymentGst(store, taxRates, row.method, share)
        }, 0)
      )
    }
  } else {
    gst = paymentGst(store, taxRates, paymentMethod, pre_gst)
  }

  const tax_amount = money(line_tax + gst)
  const total_amount = money(pre_gst + gst)
  const cost_total = money(lines.reduce((sum, line) => sum + Number(line.cost_price) * Number(line.quantity), 0))

  return {
    gross_amount,
    line_discount_amount,
    subtotal,
    discount_amount: money(orderDiscount),
    coupon_discount_amount: money(couponDiscount),
    shipping_fee,
    tax_amount,
    gst,
    line_tax,
    total_amount,
    cost_total,
  }
}

export async function loadPricingContext(storeId, { locationId, now } = {}) {
  const [offers, taxRates, shippingRule] = await Promise.all([
    Offer.findAll({
      where: { store_id: storeId },
      include: [{ model: OfferTarget }],
    }),
    PaymentMethodTaxRate.findAll({ where: { store_id: storeId } }),
    getShipping(storeId),
  ])
  return {
    offers: offers.filter((offer) => offerIsLive(offer, { locationId, now })),
    taxRates,
    shippingRule,
  }
}

export async function loadBulkTiers(storeId, productIds) {
  if (!productIds.length) return []
  return ProductBulkTier.findAll({
    where: { store_id: storeId, product_id: { [Op.in]: productIds } },
  })
}
