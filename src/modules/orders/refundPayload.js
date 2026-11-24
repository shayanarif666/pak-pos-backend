/**
 * The refund the POS sends (one object of refunds[] in POST /orders/refunds/bulk), partial and complete alike:
 *
 *   { local_id, refunded_at, order_id, refund_type (partial | complete), reason, currency,
 *     refund_items: [{ order_item_id, qty, gross_amount, discount_amount, subtotal, tax_amount, total }],
 *     order_discount_amount,
 *     total_payment_surcharge_refunded, total_refunded_amount }
 *   (optional: payments [{ method, return_amount, surcharge_amount?, bill_amount? }], refund_items[].taxes [],
 *   and the refund's own subtotal / tax_amount / discount_amount)
 *
 * Every figure is the till's and is saved as sent — the server works nothing out and checks no figure.
 * A missing or non-numeric amount is 0. Only the shape is checked here, and in order.service.js the qty
 * left on each line.
 */
import { AppError } from "../../shared/errors/AppError.js"
import { PAYMENT_METHOD } from "../../db/enums.js"
import { staffRefFrom } from "../../shared/utils/staff.util.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const REFUND_TYPES = ["partial", "complete"]
export const r2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100

function ref(row, keys, label, { required = false } = {}) {
  for (const key of keys) {
    const value = row[key]
    if (value === undefined || value === null || value === "") continue
    const text = String(value).trim()
    if ((/^\d+$/.test(text) && Number(text) > 0) || UUID_RE.test(text)) return text
    throw new AppError(`${label}.${key} must be a number or a UUID`, 400)
  }
  if (required) throw new AppError(`${label}.${keys[0]} is required`, 400)
  return null
}

function text(row, key) {
  if (row[key] === undefined || row[key] === null || row[key] === "") return null
  return String(row[key]).trim()
}

function money(row, key, label, { required = false, min = 0, positive = false } = {}) {
  const value = row[key]
  if (value === undefined || value === null || value === "") {
    if (required) throw new AppError(`${label}.${key} is required`, 400)
    return null
  }
  const number = Number(value)
  if (Number.isNaN(number) || number < min || (positive && number <= 0)) {
    throw new AppError(`${label}.${key} must be a number ${positive ? "> 0" : `>= ${min}`}`, 400)
  }
  return number
}

/** An amount the till sends, saved as sent; missing or not a number = 0 (never refused). */
function amountOr0(row, key) {
  const value = row?.[key]
  if (value === undefined || value === null || value === "") return 0
  const number = Number(value)
  return Number.isNaN(number) ? 0 : number
}

/** An optional amount: as sent, or null when missing / not a number. */
function amountOrNull(row, key) {
  const value = row?.[key]
  if (value === undefined || value === null || value === "") return null
  const number = Number(value)
  return Number.isNaN(number) ? null : number
}

/** The line's taxes as the till sent them (a record): [{ level, name, type, rate, amount }]. */
function sentTaxes(list) {
  if (!Array.isArray(list)) return []
  return list
    .filter((tax) => tax && typeof tax === "object")
    .map((tax) => ({
      ...(tax.id !== undefined ? { id: tax.id } : {}),
      level: tax.level ?? null,
      name: tax.name ?? null,
      type: tax.type ?? null,
      rate: amountOrNull(tax, "value") ?? amountOrNull(tax, "rate"),
      amount: amountOr0(tax, "amount"),
    }))
}

function parseItem(row, index, defaultRestock) {
  const label = `refund_items[${index}]`
  if (!row || typeof row !== "object") throw new AppError(`${label} is invalid`, 400)
  // The line's figures as sent; missing = 0.
  const gross = amountOr0(row, "gross_amount")
  const discount = amountOr0(row, "discount_amount")
  const subtotal = amountOr0(row, "subtotal")
  const tax = amountOr0(row, "tax_amount")
  const total = amountOr0(row, "total")
  return {
    order_item_id: ref(row, ["order_item_id", "orderItemId"], label, { required: true }),
    qty: money(row, "qty", label, { required: true, positive: true }),
    restock: row.restock === undefined || row.restock === null ? defaultRestock : Boolean(row.restock),
    gross_amount: gross,
    discount_amount: discount,
    subtotal,
    tax_amount: tax,
    total,
    taxes: sentTaxes(row.taxes),
  }
}

function parsePayment(row, index) {
  const label = `payments[${index}]`
  if (!row || typeof row !== "object") throw new AppError(`${label} is invalid`, 400)
  const method = String(row.method || "")
  // credit = the part that was udhaar: it comes off what the customer owes, nothing is paid out.
  if (!(PAYMENT_METHOD.includes(method) || method === "credit") || method === "mixed") throw new AppError(`${label}.method is invalid`, 400)
  // surcharge_amount: the part of return_amount that is surcharge given back (optional).
  return {
    method,
    return_amount: amountOr0(row, "return_amount"),
    surcharge_amount: amountOrNull(row, "surcharge_amount"),
    bill_amount: amountOrNull(row, "bill_amount"),
  }
}

export function parseRefundV2(body) {
  const label = "refund"
  const refund_type = String(body.refund_type || "")
  if (!REFUND_TYPES.includes(refund_type)) throw new AppError("refund_type must be partial or complete", 400)
  const reason = text(body, "reason")
  if (!reason) throw new AppError("reason is required", 400)
  const client_local_id = text(body, "local_id") || text(body, "client_local_id")
  if (!client_local_id) throw new AppError("local_id is required (the till's id for this refund)", 400)
  if (!Array.isArray(body.refund_items) || !body.refund_items.length) throw new AppError("refund_items needs at least one line", 400)
  const restock = body.restock === undefined || body.restock === null ? true : Boolean(body.restock)
  const items = body.refund_items.map((row, index) => parseItem(row, index, restock))
  if (new Set(items.map((row) => row.order_item_id)).size !== items.length) {
    throw new AppError("A line is listed twice: send it once with its whole qty", 400)
  }
  // payments is optional: left out, the server gives each payment method of the sale its share back.
  const sentPayments = body.payments === undefined || body.payments === null ? [] : body.payments
  if (!Array.isArray(sentPayments)) throw new AppError("payments must be an array", 400)
  const payments = sentPayments.map(parsePayment)
  if (new Set(payments.map((row) => row.method)).size !== payments.length) throw new AppError("payments lists a method twice", 400)

  const total = amountOr0(body, "total_refunded_amount")

  return {
    order_id: ref(body, ["order_id", "orderId"], label, { required: true }),
    client_local_id,
    refunded_at: text(body, "refunded_at"),
    refund_type,
    reason,
    items,
    order_discount_amount: amountOr0(body, "order_discount_amount"),
    payments,
    // Not sent: the payments' surcharge_amount as sent, added up.
    surcharge_total: amountOrNull(body, "total_payment_surcharge_refunded"),
    // The refund's own totals, when the till sends them (else the sum of its lines' figures as sent).
    subtotal: amountOrNull(body, "subtotal"),
    tax_amount: amountOrNull(body, "tax_amount"),
    discount_amount: amountOrNull(body, "discount_amount"),
    total_amount: total,
    batch_ref: ref(body, ["batch_id", "batchId"], label),
    staff_ref: staffRefFrom(body),
  }
}
