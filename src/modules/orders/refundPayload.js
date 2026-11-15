/**
 * The refund the POS sends (one object of refunds[] in POST /orders/refunds/bulk), partial and complete alike:
 *
 *   { local_id, refunded_at, order_id, refund_type (partial | complete), reason, currency,
 *     refund_items: [{ order_item_id, qty, gross_amount, discount_amount, subtotal, tax_amount, total }],
 *     order_discount_amount,
 *     payments: [{ method, return_amount }],
 *     total_payment_surcharge_refunded, total_refunded_amount }
 *
 * This file only checks what can be checked without the order (the arithmetic of a line, the payments adding
 * up to the total); order.service.js checks the rest against the saved sale (qty left, each line's share of
 * what was sold, the order discount share, what each payment method gets back and its surcharge).
 */
import { AppError } from "../../shared/errors/AppError.js"
import { PAYMENT_METHOD } from "../../db/enums.js"
import { staffRefFrom } from "../../shared/utils/staff.util.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOLERANCE = 0.02

export const REFUND_TYPES = ["partial", "complete"]
export const r2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100
const close = (a, b, tolerance = TOLERANCE) => Math.abs(Number(a) - Number(b)) <= tolerance

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

function parseItem(row, index, defaultRestock) {
  const label = `refund_items[${index}]`
  if (!row || typeof row !== "object") throw new AppError(`${label} is invalid`, 400)
  const gross = money(row, "gross_amount", label, { required: true })
  const discount = money(row, "discount_amount", label, { required: true })
  const subtotal = money(row, "subtotal", label, { required: true })
  const tax = money(row, "tax_amount", label, { required: true })
  const total = money(row, "total", label, { required: true })
  if (!close(subtotal, gross - discount)) throw new AppError(`${label}.subtotal ${subtotal} is not gross_amount − discount_amount (${r2(gross - discount)})`, 400)
  if (!close(total, subtotal + tax)) throw new AppError(`${label}.total ${total} is not subtotal + tax_amount (${r2(subtotal + tax)})`, 400)
  return {
    order_item_id: ref(row, ["order_item_id", "orderItemId"], label, { required: true }),
    qty: money(row, "qty", label, { required: true, positive: true }),
    restock: row.restock === undefined || row.restock === null ? defaultRestock : Boolean(row.restock),
    gross_amount: gross,
    discount_amount: discount,
    subtotal,
    tax_amount: tax,
    total,
  }
}

function parsePayment(row, index) {
  const label = `payments[${index}]`
  if (!row || typeof row !== "object") throw new AppError(`${label} is invalid`, 400)
  const method = String(row.method || "")
  // credit = the part that was udhaar: it comes off what the customer owes, nothing is paid out.
  if (!(PAYMENT_METHOD.includes(method) || method === "credit") || method === "mixed") throw new AppError(`${label}.method is invalid`, 400)
  return { method, return_amount: money(row, "return_amount", label, { required: true, positive: true }) }
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
  if (!Array.isArray(body.payments) || !body.payments.length) throw new AppError("payments needs at least one row", 400)
  const payments = body.payments.map(parsePayment)
  if (new Set(payments.map((row) => row.method)).size !== payments.length) throw new AppError("payments lists a method twice", 400)

  const total = money(body, "total_refunded_amount", label, { required: true, positive: true })
  const returned = r2(payments.reduce((sum, row) => sum + row.return_amount, 0))
  if (!close(returned, total, 0.011)) throw new AppError(`total_refunded_amount ${total} is not the sum of the payments (${returned})`, 400)

  return {
    order_id: ref(body, ["order_id", "orderId"], label, { required: true }),
    client_local_id,
    refunded_at: text(body, "refunded_at"),
    refund_type,
    reason,
    items,
    order_discount_amount: money(body, "order_discount_amount", label) ?? 0,
    payments,
    surcharge_total: money(body, "total_payment_surcharge_refunded", label, { required: true }),
    total_amount: total,
    batch_ref: ref(body, ["batch_id", "batchId"], label),
    staff_ref: staffRefFrom(body),
  }
}
