/**
 * The order the POS sends (one object of orders[] in POST /orders/bulk): the till works out every
 * figure and the server saves them exactly as sent — no figure is worked out again or checked against the
 * others (a line's gross, discount, subtotal, tax, total; a payment's surcharge and amount; the summary).
 * Only the shape is checked: required fields, numbers >= 0, ids, levels, methods.
 *
 *   { local_id, placed_at, customer_id, tax_exempt, discount_exempt,
 *     order_items: [{ product_id, variant_id, sale_unit, qty, price, gross_amount,
 *                     discount: [{ id, level, name, type, value }], discount_amount, subtotal,
 *                     taxes: [{ id, level, name, type, value }], tax_amount, total,
 *                     bundle_id?, bundle_role? }]   (a custom line: is_custom, name, product_id null)
 *     bundles?: [{ id, name, reward_type, value }],
 *     order_discount: { id, name, type, value } | null,
 *     payments: [{ method, bill_amount, surcharge_active, type, value, surcharge_amount, amount, paid }],
 *     summary: { currency, total_items, gross_amount, items_discount_amount, subtotal, order_discount_amount,
 *                tax_amount, surcharge_amount, total_amount } }
 *
 * How the till works the figures out (the server does not redo it):
 *   line gross = qty × price; every discount is taken off the gross (a percentage of it, or a fixed amount),
 *   none on top of another; subtotal = gross − discounts; every tax is on the subtotal; total = subtotal + taxes.
 *   The order discount comes off the lines' totals together; that is the bill. A payment method pays its
 *   bill_amount (its share of the bill) plus its surcharge (only while surcharge_active); cash is rounded
 *   to the whole rupee. total_amount = what the payments add up to.
 */
import { AppError } from "../../shared/errors/AppError.js"
import { PAYMENT_METHOD } from "../../db/enums.js"
import { staffRefFrom } from "../../shared/utils/staff.util.js"

export const ITEM_DISCOUNT_LEVELS = ["category", "product", "variant", "store", "bulk", "manual", "bundle"]
export const ITEM_TAX_LEVELS = ["store", "category", "product", "variant"]
const BUNDLE_REWARDS = ["free_item", "percentage", "fixed"]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const r2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100

function ref(row, keys, label) {
  for (const key of keys) {
    const value = row[key]
    if (value === undefined || value === null || value === "") continue
    const text = String(value).trim()
    if ((/^\d+$/.test(text) && Number(text) > 0) || UUID_RE.test(text)) return text
    throw new AppError(`${label}.${key} must be a number or a UUID`, 400)
  }
  return null
}

function text(row, key) {
  if (row[key] === undefined || row[key] === null || row[key] === "") return null
  return String(row[key]).trim()
}

function money(row, key, label, { required = false, min = 0 } = {}) {
  const value = row[key]
  if (value === undefined || value === null || value === "") {
    if (required) throw new AppError(`${label}.${key} is required`, 400)
    return null
  }
  const number = Number(value)
  if (Number.isNaN(number) || number < min) throw new AppError(`${label}.${key} must be a number >= ${min}`, 400)
  return number
}

/** An id of a discount / tax / bundle: null, or a positive whole number. */
function entryId(entry, label) {
  const value = entry.id
  if (value === undefined || value === null || value === "") return null
  if (!/^\d+$/.test(String(value)) || Number(value) < 1) throw new AppError(`${label}.id must be null or a number`, 400)
  return Number(value)
}

/** The amount a discount / tax entry was sent with (null when it has none). */
function entryAmount(entry) {
  if (!entry || entry.amount === undefined || entry.amount === null || entry.amount === "") return null
  const value = Number(entry.amount)
  return Number.isNaN(value) ? null : r2(value)
}

/** One discount of a line and what it takes off: a percentage of the gross, or a fixed amount. */
function discountAmount(entry, gross) {
  return entry.type === "fixed" ? Math.min(entry.value, gross) : r2((gross * entry.value) / 100)
}

/** One tax of a line and what it charges: a percentage of the subtotal, or a fixed amount per unit. */
function taxAmount(entry, subtotal, qty) {
  return entry.type === "fixed" ? r2(entry.value * qty) : r2((subtotal * entry.value) / 100)
}

function parseEntries(list, label, { levels, custom, kind }) {
  if (list === undefined || list === null) return []
  if (!Array.isArray(list)) throw new AppError(`${label} must be an array`, 400)
  return list.map((entry, index) => {
    const at = `${label}[${index}]`
    if (!entry || typeof entry !== "object") throw new AppError(`${at} is invalid`, 400)
    const level = String(entry.level || "")
    if (!levels.includes(level)) throw new AppError(`${at}.level must be ${levels.join(", ")}`, 400)
    const type = entry.type === undefined || entry.type === null ? "percentage" : String(entry.type)
    if (type !== "percentage" && type !== "fixed") throw new AppError(`${at}.type must be percentage or fixed`, 400)
    const value = money(entry, "value", at, { required: true })
    if (type === "percentage" && value > 100 && kind === "discount") throw new AppError(`${at}.value cannot be more than 100%`, 400)
    const id = entryId(entry, at)
    if (!custom) {
      // A catalog line: the product / category / variant discounts and the category / product / variant taxes come
      // from the product itself (no id); the others are picked from their page (an id), a manual one has none.
      const own = kind === "discount" ? ["category", "product", "variant", "manual"] : ["category", "product", "variant"]
      const picked = kind === "discount" ? ["store", "bulk", "bundle"] : ["store"]
      if (own.includes(level) && id != null) throw new AppError(`${at}: a ${level} ${kind} has no id (send null)`, 400)
      if (kind === "discount" && picked.includes(level) && id == null) throw new AppError(`${at}: a ${level} discount needs its id`, 400)
    }
    return { id, level, name: text(entry, "name"), type, value }
  })
}

function parseLine(row, index) {
  const label = `order_items[${index}]`
  if (!row || typeof row !== "object") throw new AppError(`${label} is invalid`, 400)
  const isCustom = Boolean(row.is_custom)
  const qty = Number(row.qty ?? row.quantity)
  if (Number.isNaN(qty) || qty <= 0) throw new AppError(`${label}.qty must be > 0`, 400)
  const price = money(row, "price", label, { required: true })
  const product_id = ref(row, ["product_id"], label)
  const title = text(row, "name") || text(row, "title")
  if (isCustom) {
    if (product_id) throw new AppError(`${label}: a custom line has no product_id`, 400)
    if (!title) throw new AppError(`${label}.name is required on a custom line`, 400)
  } else if (!product_id) {
    throw new AppError(`${label}.product_id is required (or is_custom: true with a name)`, 400)
  }
  const saleUnit = row.sale_unit === undefined || row.sale_unit === null || row.sale_unit === "" ? "unit" : row.sale_unit
  if (saleUnit !== "unit" && saleUnit !== "pack") throw new AppError(`${label}.sale_unit must be unit or pack`, 400)

  const discounts = parseEntries(row.discount, `${label}.discount`, { levels: ITEM_DISCOUNT_LEVELS, custom: isCustom, kind: "discount" })
  const taxes = parseEntries(row.taxes, `${label}.taxes`, { levels: ITEM_TAX_LEVELS, custom: isCustom, kind: "tax" })

  // The figures are saved as the till sent them. Only gross_amount may be left out (then qty × price).
  const gross = row.gross_amount != null && row.gross_amount !== "" ? money(row, "gross_amount", label) : r2(qty * price)
  const sentDiscount = money(row, "discount_amount", label, { required: true })
  const sentSubtotal = money(row, "subtotal", label, { required: true })
  const sentTax = money(row, "tax_amount", label, { required: true })
  const sentTotal = money(row, "total", label, { required: true })
  // Each discount / tax entry's own amount: the one sent (amount), else its share for the record (never checked).
  const withAmounts = discounts.map((entry, i) => ({ ...entry, amount: entryAmount(row.discount?.[i]) ?? discountAmount(entry, gross) }))
  const taxesWithAmounts = taxes.map((entry, i) => ({ ...entry, amount: entryAmount(row.taxes?.[i]) ?? taxAmount(entry, sentSubtotal, qty) }))

  const bundle_id = row.bundle_id == null || row.bundle_id === "" ? null : Number(row.bundle_id)
  if (bundle_id != null && (!Number.isInteger(bundle_id) || bundle_id < 1)) throw new AppError(`${label}.bundle_id must be a number`, 400)
  const bundle_role = row.bundle_role == null || row.bundle_role === "" ? null : String(row.bundle_role)
  if (bundle_id != null && !["buy", "reward"].includes(bundle_role || "")) throw new AppError(`${label}.bundle_role must be buy or reward`, 400)
  if (bundle_id == null && bundle_role) throw new AppError(`${label}.bundle_role needs a bundle_id`, 400)

  return {
    product_id,
    variant_id: ref(row, ["variant_id"], label),
    sale_unit: saleUnit,
    title,
    custom_category: text(row, "category"),
    quantity: qty,
    weight: null,
    unit_price: price,
    cost_price: money(row, "cost_price", label),
    bundle_id,
    bundle_role,
    priced: {
      discount: {
        source: withAmounts.length ? (withAmounts.length === 1 ? withAmounts[0].level : "multiple") : "none",
        offer_refs: [],
        amount: sentDiscount,
        free_qty: 0,
        entries: withAmounts,
      },
      taxes: taxesWithAmounts.map((entry) => ({ id: entry.id, level: entry.level, name: entry.name, type: entry.type, rate: entry.value, amount: entry.amount })),
      gross_amount: gross,
      subtotal: sentSubtotal,
      tax_amount: sentTax,
      total: sentTotal,
    },
    figures: { gross, discount: sentDiscount, subtotal: sentSubtotal, tax: sentTax, total: sentTotal },
  }
}

function parseBundles(list, lines) {
  if (list === undefined || list === null) list = []
  if (!Array.isArray(list)) throw new AppError("bundles must be an array", 400)
  const bundles = list.map((entry, index) => {
    const label = `bundles[${index}]`
    if (!entry || typeof entry !== "object") throw new AppError(`${label} is invalid`, 400)
    const id = Number(entry.id)
    if (!Number.isInteger(id) || id < 1) throw new AppError(`${label}.id must be a number`, 400)
    const reward_type = String(entry.reward_type || "")
    if (!BUNDLE_REWARDS.includes(reward_type)) throw new AppError(`${label}.reward_type must be ${BUNDLE_REWARDS.join(", ")}`, 400)
    const value = reward_type === "free_item" ? null : money(entry, "value", label, { required: true })
    return { id, name: text(entry, "name"), reward_type, value }
  })
  const ids = bundles.map((bundle) => bundle.id)
  if (new Set(ids).size !== ids.length) throw new AppError("bundles lists a bundle twice", 400)
  for (const line of lines) {
    if (line.bundle_id != null && !ids.includes(line.bundle_id)) throw new AppError(`bundle ${line.bundle_id} is on a line but not in bundles`, 400)
  }
  for (const bundle of bundles) {
    if (!lines.some((line) => line.bundle_id === bundle.id)) throw new AppError(`bundle ${bundle.id} is in bundles but on no line`, 400)
  }
  return bundles
}

function parseOrderDiscount(value, linesTotal, sentAmount = null) {
  if (value === undefined || value === null) return null
  if (typeof value !== "object") throw new AppError("order_discount must be an object or null", 400)
  const type = value.type === undefined || value.type === null ? "percentage" : String(value.type)
  if (type !== "percentage" && type !== "fixed") throw new AppError("order_discount.type must be percentage or fixed", 400)
  const amountValue = money(value, "value", "order_discount", { required: true })
  if (type === "percentage" && amountValue > 100) throw new AppError("order_discount.value cannot be more than 100%", 400)
  // The amount is the till's (summary.order_discount_amount); worked out only when it was not sent.
  const amount = sentAmount != null ? sentAmount : type === "fixed" ? Math.min(amountValue, linesTotal) : r2((linesTotal * amountValue) / 100)
  return { id: entryId(value, "order_discount"), name: text(value, "name"), type, value: amountValue, amount: r2(amount) }
}

function parsePayment(row, index) {
  const label = `payments[${index}]`
  if (!row || typeof row !== "object") throw new AppError(`${label} is invalid`, 400)
  const method = String(row.method || "")
  if (!PAYMENT_METHOD.includes(method) || method === "mixed") throw new AppError(`${label}.method is invalid`, 400)
  const bill_amount = money(row, "bill_amount", label, { required: true })
  const active = row.surcharge_active === undefined || row.surcharge_active === null ? false : Boolean(row.surcharge_active)
  const type = row.type === undefined || row.type === null || row.type === "" ? null : String(row.type)
  if (type && type !== "percentage" && type !== "fixed") throw new AppError(`${label}.type must be percentage or fixed`, 400)
  const value = money(row, "value", label) ?? 0
  // The surcharge and the amount are saved as the till sent them (not checked against bill_amount / value).
  const surcharge_amount = money(row, "surcharge_amount", label) ?? 0
  const amount = money(row, "amount", label, { required: true })
  const paid = money(row, "paid", label) ?? amount
  const raw_id = row.transaction_id ?? row.transactionId
  return {
    method,
    amount,
    bill_share: bill_amount,
    paid,
    surcharge_active: active,
    surcharge_type: type,
    surcharge_value: type ? value : null,
    surcharge_amount,
    transaction_id: raw_id == null || raw_id === "" ? null : String(raw_id).trim().slice(0, 255),
  }
}

export function parseOrderV2(body) {
  if (!Array.isArray(body.order_items) || !body.order_items.length) throw new AppError("order_items are required", 400)
  const taxExempt = Boolean(body.tax_exempt ?? body.tax_exampt)
  const discountExempt = Boolean(body.discount_exempt ?? body.discount_exampt)
  const lines = body.order_items.map(parseLine)

  if (taxExempt && lines.some((line) => line.priced.taxes.length || line.figures.tax > 0)) {
    throw new AppError("tax_exempt is true: no line can have a tax", 400)
  }
  if (discountExempt && lines.some((line) => line.priced.discount.entries.length || line.figures.discount > 0)) {
    throw new AppError("discount_exempt is true: no line can have a discount", 400)
  }

  // The order's totals are the till's summary, saved as sent (not checked against the lines or the payments).
  const summary = body.summary && typeof body.summary === "object" ? body.summary : null
  if (!summary) throw new AppError("summary is required", 400)
  const sent = (key) => money(summary, key, "summary", { required: true })
  const gross = sent("gross_amount")
  const itemsDiscount = sent("items_discount_amount")
  const subtotal = sent("subtotal")
  const tax = sent("tax_amount")
  const surcharge = sent("surcharge_amount")
  const total = sent("total_amount")
  const orderDiscountSent = sent("order_discount_amount")

  const linesTotal = r2(lines.reduce((sum, line) => sum + line.figures.total, 0))
  const order_discount = parseOrderDiscount(body.order_discount, linesTotal, orderDiscountSent)
  if (discountExempt && order_discount) throw new AppError("discount_exempt is true: send order_discount null", 400)

  const bundles = parseBundles(body.bundles, lines)

  if (!Array.isArray(body.payments) || !body.payments.length) throw new AppError("payments needs at least one row", 400)
  const payments = body.payments.map(parsePayment)

  const items = lines.map(({ figures: _figures, ...line }) => line)
  const methods = payments.map((row) => row.method)
  const payment_method = payments.length > 1 ? "mixed" : methods[0]
  const placedAt = text(body, "placed_at")
  return {
    channel: "pos",
    precomputed: true,
    v2: true,
    items,
    payments,
    payment_method,
    is_custom: items.every((line) => !line.product_id),
    customer_id: ref(body, ["customer_id", "customerId"], "order"),
    staff_ref: staffRefFrom(body),
    register_session_id: ref(body, ["batch_id", "batchId", "register_session_id"], "order"),
    client_local_id: text(body, "local_id") || text(body, "client_local_id"),
    local_receipt_number: text(body, "local_receipt_number"),
    approval_request_id: text(body, "approval_request_id"),
    placed_at: placedAt,
    offline: Boolean(body.offline),
    tax_exempt: taxExempt,
    discount_exempt: discountExempt,
    offer_exempt: false,
    bundles,
    order_discount,
    coupon: null,
    shipping_fee: 0,
    total_amount: total,
    gross_amount: gross,
    lines_discount_amount: itemsDiscount,
    lines_subtotal: subtotal,
    lines_tax_amount: tax,
    surcharge_amount: surcharge,
  }
}
