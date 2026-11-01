import { Op } from "sequelize"
import { Offer } from "../offers/offer.model.js"
import { OfferTarget } from "../offers/offerTarget.model.js"
import { OfferLocation } from "../offers/offerLocation.model.js"
import { ProductBulkTier } from "../catalog/productBulkTier.model.js"
import { PaymentMethodTaxRate } from "../stores/paymentMethodTaxRate.model.js"
import { getShipping } from "../stores/store.service.js"
import { AppError } from "../../shared/errors/AppError.js"

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

/**
 * Discount on one unit: the product's own discount, then the category's discount on what is
 * left (both apply, one after the other: 100 → 5% → 95 → 5% → 90.25). Each is capped so the
 * price never goes below 0.
 */
export function productUnitDiscount(product, category) {
  const { own, fromCategory } = unitDiscountParts(product, category)
  return money(own + fromCategory)
}

/** The two parts of productUnitDiscount: the product's own and the category's (per unit). */
export function unitDiscountParts(product, category) {
  const list = Number(product.selling_price || 0)
  const own = product.has_product_discount
    ? applyDiscount(list, product.discount_type, product.discount_value)
    : 0
  const cat = categoryOf(product, category)
  const fromCategory =
    cat?.discount_type && cat.discount_value != null
      ? applyDiscount(money(list - own), cat.discount_type, cat.discount_value)
      : 0
  return { own, fromCategory, category: cat }
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
  // location_scope "selected": only at the locations in offer_locations.
  if (offer.location_scope === "selected") {
    const links = offer.offerLocations || []
    if (!links.some((link) => link.location_id === locationId)) return false
  }
  if (offer.start_at && now < new Date(offer.start_at)) return false
  if (offer.end_at && now > new Date(offer.end_at)) return false
  return true
}

function matchingTargets(offer, product) {
  return (offer.OfferTargets || offer.targets || [])
    .filter((target) => targetMatches(target, product))
    .sort((a, b) => (b.product_id === product.id) - (a.product_id === product.id))
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
  // Where the catalog discount comes from — by the amounts actually taken off (a 0% discount
  // is no discount).
  const parts = unitDiscountParts(product, product.Category || product.category)
  const catalogSource = parts.own > 0
    ? parts.fromCategory > 0
      ? "product+category"
      : "product"
    : parts.fromCategory > 0
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
      offer,
      target,
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
      offer: bulk.offer || null,
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
      offer,
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
    discount_source: discountSource(best.source),
    // The offer that priced this line, as it was at the sale (kept on the order line).
    offers: best.offer ? [offerSnapshot(best.offer, best.target, best.discount)] : [],
    free_qty: best.free_qty || 0,
    // The product / category discount, when it (and not an offer) priced the line.
    product_discount:
      CATALOG_SOURCES.includes(best.source) && parts.own > 0
        ? discountSnapshot(product.discount_name, product.discount_type, product.discount_value, parts.own * qty)
        : null,
    category_discount:
      CATALOG_SOURCES.includes(best.source) && parts.fromCategory > 0
        ? discountSnapshot(
            parts.category?.discount_name,
            parts.category?.discount_type,
            parts.category?.discount_value,
            parts.fromCategory * qty
          )
        : null,
  }
}

const CATALOG_SOURCES = ["product", "category", "product+category"]

function discountSnapshot(name, type, value, amount) {
  return { name: name || null, type: type || null, value: value == null ? null : Number(value), amount: money(amount) }
}

/** Where a line's discount came from: none | product | category | product+category | bulk_tier | offer | custom. */
export function discountSource(pricingSource) {
  if (["flash_sale", "promotional", "bogo", "offer_bulk"].includes(pricingSource)) return "offer"
  if (pricingSource === "product_bulk") return "bulk_tier"
  if (pricingSource === "list" || !pricingSource) return "none"
  return pricingSource
}

/** An offer as it was when it priced a line: { id (offer number), name, type, …, amount saved }. */
export function offerSnapshot(offer, target, amount) {
  return {
    id: offer.offer_number ?? null,
    name: offer.name || null,
    type: offer.type,
    discount_type: offer.discount_type || null,
    discount_value: offer.discount_value == null ? null : Number(offer.discount_value),
    min_qty: offer.min_qty == null ? null : Number(offer.min_qty),
    buy_qty: offer.buy_qty == null ? null : Number(offer.buy_qty),
    get_qty: offer.get_qty == null ? null : Number(offer.get_qty),
    promo_price: target?.promo_price == null ? null : Number(target.promo_price),
    amount: money(amount),
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

/** A product's taxes as a clean list: [{ name, type: percentage | fixed, value }]. */
export function productTaxList(product) {
  const raw = product?.taxes
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? safeParse(raw) : []
  return list
    .filter((tax) => tax && (tax.type === "percentage" || tax.type === "fixed") && tax.value != null)
    .map((tax) => ({ name: tax.name || "Tax", type: tax.type, value: Number(tax.value) }))
}

function safeParse(text) {
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** One tax on a base: a percentage of it, or a fixed amount per unit. */
export function taxOn(base, type, value, units = 1) {
  const amount = Number(value || 0)
  if (!type || amount <= 0) return 0
  return type === "percentage" ? money((Number(base) * amount) / 100) : money(amount * Number(units || 1))
}

/**
 * Taxes of one sale line, each on the line's taxable amount (after discounts) — they do not
 * stack on each other:
 * - product taxes: every tax in the product's list
 * - category tax: the category's single tax
 * - sales tax: the store's sales_tax_rate, while sales_tax_enabled is on
 * A fixed tax is per unit (× qty). Nothing applies while the store's charge_tax_on_sales is off.
 */
export function lineTaxBreakdown(store, product, category, taxable, qty = 1) {
  const taxes = productTaxList(product)
  const breakdown = {
    product_taxes: taxes.map((tax) => ({ ...tax, amount: 0 })),
    category_tax_type: category?.tax_type || null,
    category_tax_value: category?.tax_value == null ? null : Number(category.tax_value),
    sales_tax_rate: store?.sales_tax_rate == null ? null : Number(store.sales_tax_rate),
    product_tax_amount: 0,
    category_tax_amount: 0,
    sales_tax_amount: 0,
    tax_amount: 0,
  }
  if (!store?.charge_tax_on_sales) return breakdown

  const base = money(taxable)
  breakdown.product_taxes = taxes.map((tax) => ({ ...tax, amount: taxOn(base, tax.type, tax.value, qty) }))
  breakdown.product_tax_amount = money(
    breakdown.product_taxes.reduce((sum, tax) => sum + tax.amount, 0)
  )
  if (category?.tax_type && category.tax_value != null) {
    breakdown.category_tax_amount = taxOn(base, category.tax_type, category.tax_value, qty)
  }
  // Sales tax: only while the store has it switched on.
  if (store.sales_tax_enabled !== false && store.sales_tax_rate != null && Number(store.sales_tax_rate) > 0) {
    breakdown.sales_tax_amount = taxOn(base, "percentage", store.sales_tax_rate)
  }

  breakdown.tax_amount = money(
    breakdown.product_tax_amount + breakdown.category_tax_amount + breakdown.sales_tax_amount
  )
  return breakdown
}

export function lineTaxAmount(store, product, category, taxable, qty = 1) {
  return lineTaxBreakdown(store, product, category, taxable, qty).tax_amount
}

export function quoteShipping(channel, rule, afterDiscounts) {
  if (channel !== "web") return 0
  if (!rule) return 0
  const flat = money(rule.flat_fee)
  const freeOver = rule.free_over_amount == null ? null : Number(rule.free_over_amount)
  if (freeOver != null && Number(afterDiscounts) >= freeOver) return 0
  return flat
}

// Payment-method GST: only while the store has charge_tax_on_sales and payment_tax_enabled on.
export function paymentGst(store, rates, method, taxableShare) {
  if (!store.charge_tax_on_sales || store.payment_tax_enabled === false) return 0
  if (!method || method === "mixed") return 0
  const row = (rates || []).find((rate) => rate.payment_method === method)
  if (!row) return 0
  return applyDiscount(taxableShare, "percentage", row.gst_percent)
}

/**
 * Payment-method GST on a split bill. The bill before payment tax (pre_gst) is shared between
 * the payments; each method's tax is on its own share only:
 *   amount (what the method pays toward the bill) = bill_share + bill_share × gst_percent%
 * A row's share is its bill_share; without one, a card / wallet row's amount is taken as already
 * including its tax (share = amount ÷ (1 + rate)), and the first cash row (or a lone row) covers
 * what is left. Only cash can be overpaid: paid − amount is its change. A share not covered by
 * any payment is left as credit (no payment tax on it).
 */
export function splitPaymentTax({ store, taxRates, preGst, payments, paymentMethod, taxExempt = false }) {
  const enabled = !taxExempt && Boolean(store.charge_tax_on_sales) && store.payment_tax_enabled !== false
  const percentOf = (method) =>
    enabled ? Number((taxRates || []).find((rate) => rate.payment_method === method)?.gst_percent || 0) : 0
  const rows = payments?.length
    ? payments
    : paymentMethod && paymentMethod !== "mixed"
      ? [{ method: paymentMethod }]
      : []

  // The row that covers the rest of the bill: the first cash row without a bill_share, else a lone row.
  let rest = rows.findIndex((row) => row.method === "cash" && row.bill_share == null)
  if (rest < 0 && rows.length === 1 && rows[0].bill_share == null) rest = 0

  const splits = rows.map((row, index) => {
    const gst_percent = percentOf(row.method)
    if (index === rest) return { row, gst_percent, bill_share: null, gst_amount: null }
    if (row.bill_share != null) {
      const bill_share = money(row.bill_share)
      return { row, gst_percent, bill_share, gst_amount: money((bill_share * gst_percent) / 100) }
    }
    const amount = money(row.amount)
    const bill_share = money(amount / (1 + gst_percent / 100))
    return { row, gst_percent, bill_share, gst_amount: money(amount - bill_share) }
  })
  const fixed = money(splits.reduce((sum, split) => sum + (split.bill_share ?? 0), 0))
  if (fixed > money(preGst) + 0.01) {
    throw new AppError("Payments are more than the bill; only cash can be overpaid", 400)
  }
  if (rest >= 0) {
    const bill_share = money(Math.max(0, preGst - fixed))
    splits[rest].bill_share = bill_share
    splits[rest].gst_amount = money((bill_share * splits[rest].gst_percent) / 100)
  }

  const result = splits.map((split, index) => {
    const { row, gst_percent } = split
    let { bill_share, gst_amount } = split
    let amount = money(bill_share + gst_amount)
    // The rest row handed over less than the rest of the bill: it pays only that, the remainder is credit.
    const handed = row.paid ?? row.amount
    if (index === rest && handed != null && Number(handed) + 0.01 < amount) {
      amount = money(handed)
      bill_share = money(amount / (1 + gst_percent / 100))
      gst_amount = money(amount - bill_share)
    }
    // A cash row without paid: its amount is what was handed over (older tills send it that way).
    const paid = money(
      row.paid ?? (row.amount == null ? amount : row.method === "cash" ? Math.max(row.amount, amount) : row.amount)
    )
    // A till that sends both amount and paid has worked out amount itself: it must match.
    if (row.paid != null && row.amount != null && Math.abs(Number(row.amount) - amount) > 0.01) {
      throw new AppError(`${row.method} amount sent ${row.amount}, expected ${amount}`, 400)
    }
    if (row.method !== "cash" && paid > amount + 0.01) {
      throw new AppError("Payments are more than the bill; only cash can be overpaid", 400)
    }
    if (paid + 0.01 < amount) {
      throw new AppError(`${row.method} paid is less than its amount ${amount}`, 400)
    }
    return {
      method: row.method,
      bill_share,
      gst_percent,
      gst_amount,
      amount,
      paid,
      change: row.method === "cash" ? money(Math.max(0, paid - amount)) : 0,
      transaction_id: row.transaction_id || null,
    }
  })
  return {
    splits: result,
    gst: money(result.reduce((sum, split) => sum + split.gst_amount, 0)),
    covered: money(result.reduce((sum, split) => sum + split.bill_share, 0)),
  }
}

/**
 * A refund paid back the way the sale was paid. Each method (and the udhaar left as credit) gets
 * back its own part of what it paid, with its own payment tax:
 *   method refund = method amount × goods share × refunded fraction − already refunded to it
 * fraction is cumulative (everything refunded so far, this refund included), so the paisa lost
 * to rounding on one unit comes back on a later one and a fully refunded order returns exactly
 * what each method paid. goodsShare leaves shipping out (it is not refunded with items).
 */
export function splitRefund({ buckets, refunded = {}, fraction, goodsShare = 1 }) {
  const cumulative = Math.min(1, Math.max(0, Number(fraction) || 0))
  return (buckets || [])
    .map((bucket) => {
      const target = money(Number(bucket.amount) * goodsShare * cumulative)
      const amount = money(Math.max(0, target - Number(refunded[bucket.method] || 0)))
      const percent = Number(bucket.gst_percent || 0)
      const payment_tax_amount = money((amount * percent) / (100 + percent))
      return {
        method: bucket.method,
        bill_share: money(amount - payment_tax_amount),
        payment_tax_percent: percent,
        payment_tax_amount,
        amount,
      }
    })
    .filter((row) => row.amount > 0)
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

  const product_tax_amount = taxExempt
    ? 0
    : money(lines.reduce((sum, line) => sum + Number(line.product_tax_amount || 0), 0))
  const category_tax_amount = taxExempt
    ? 0
    : money(lines.reduce((sum, line) => sum + Number(line.category_tax_amount || 0), 0))
  const sales_tax_amount = taxExempt
    ? 0
    : money(lines.reduce((sum, line) => sum + Number(line.sales_tax_amount || 0), 0))

  let gst = 0
  const payment_gst_splits = []
  if (!taxExempt) {
    const splits = paymentSplits?.length
      ? paymentSplits
      : paymentMethod && paymentMethod !== "mixed"
        ? [{ method: paymentMethod, amount: pre_gst }]
        : []
    const splitSum = splits.reduce((sum, row) => sum + Number(row.amount || 0), 0)
    for (const row of splits) {
      const share = splitSum > 0 ? (Number(row.amount) / splitSum) * pre_gst : 0
      const gst_percent = Number(
        (taxRates || []).find((rate) => rate.payment_method === row.method)
          ?.gst_percent || 0
      )
      const gst_amount = paymentGst(store, taxRates, row.method, share)
      gst = money(gst + gst_amount)
      payment_gst_splits.push({
        method: row.method,
        amount: money(row.amount),
        gst_percent,
        gst_amount,
      })
    }
  }

  const fbr_tax_amount =
    !taxExempt && store.fbr_invoice_enabled ? money(line_tax + gst) : 0
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
    product_tax_amount,
    category_tax_amount,
    sales_tax_amount,
    payment_gst_amount: gst,
    payment_gst_splits,
    fbr_invoice_enabled: Boolean(store.fbr_invoice_enabled),
    fbr_tax_amount,
    sales_tax_rate:
      store.sales_tax_rate == null ? null : Number(store.sales_tax_rate),
    total_amount,
    cost_total,
  }
}

export async function loadPricingContext(storeId, { locationId, now } = {}) {
  const [offers, taxRates, shippingRule] = await Promise.all([
    Offer.findAll({
      where: { store_id: storeId },
      include: [
        { model: OfferTarget },
        { model: OfferLocation, as: "offerLocations", attributes: ["location_id"] },
      ],
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
