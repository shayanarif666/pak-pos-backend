import { AppError } from "../../shared/errors/AppError.js"
import { STOCK_MOVEMENT_REASON } from "../../db/enums.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function optionalUuid(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  const value = String(body[key])
  if (!UUID_RE.test(value)) throw new AppError(`${key} must be a UUID`, 400)
  return value
}

function optionalNumber(body, key, { min = 0 } = {}) {
  if (body[key] === undefined || body[key] === null || body[key] === "") {
    return undefined
  }
  const n = Number(body[key])
  if (Number.isNaN(n) || n < min) {
    throw new AppError(`${key} must be a number >= ${min}`, 400)
  }
  return n
}

export function parsePutStock(body) {
  const qty = optionalNumber(body, "qty")
  const delta = body.delta === undefined || body.delta === null || body.delta === ""
    ? undefined
    : Number(body.delta)
  if (delta !== undefined && Number.isNaN(delta)) {
    throw new AppError("delta must be a number", 400)
  }
  if (
    qty === undefined &&
    delta === undefined &&
    body.low_stock_threshold === undefined &&
    body.expiry_date === undefined
  ) {
    throw new AppError("qty, delta, low_stock_threshold, or expiry_date is required", 400)
  }

  let reason
  if (body.reason !== undefined && body.reason !== null && body.reason !== "") {
    if (!STOCK_MOVEMENT_REASON.includes(body.reason)) {
      throw new AppError("Invalid stock movement reason", 400)
    }
    reason = body.reason
  }

  return {
    location_id: optionalUuid(body, "location_id"),
    qty,
    delta,
    reason,
    reason_note:
      body.reason_note === undefined || body.reason_note === null
        ? null
        : String(body.reason_note).trim(),
    low_stock_threshold:
      body.low_stock_threshold === undefined
        ? undefined
        : body.low_stock_threshold === null || body.low_stock_threshold === ""
          ? null
          : optionalNumber(body, "low_stock_threshold"),
    expiry_date:
      body.expiry_date === undefined
        ? undefined
        : body.expiry_date === null || body.expiry_date === ""
          ? null
          : String(body.expiry_date).trim(),
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// A manual stock change: not the ones a sale, refund or transfer writes.
const EDIT_REASONS = STOCK_MOVEMENT_REASON.filter((reason) => !["sale", "refund", "transfer", "custom_sale", "opening_balance"].includes(reason))
const EDIT_TYPES = ["stock_in", "stock_out", "adjustment"]

function nonNegative(item, key, { integer = false } = {}) {
  const value = Number(item[key])
  if (item[key] === null || item[key] === "" || Number.isNaN(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new AppError(`${key} must be ${integer ? "a whole number" : "a number"} of 0 or more`, 400)
  }
  return value
}

/**
 * One item of PATCH /product-stocks/bulk (product_id / variant_id / location_id are read by the
 * controller). The new stock: qty (the total in units), or delta (+ adds / − takes away), or for a
 * pack product number_of_packs (+ loose_units when it sells loose); expiry_date (YYYY-MM-DD, null
 * clears it), low_stock_threshold (null = the product's own), reason, movement_type, reason_note.
 */
export function parseStockEditItem(item) {
  const out = {}
  if (item.qty !== undefined) out.qty = nonNegative(item, "qty")
  if (item.delta !== undefined) {
    const delta = Number(item.delta)
    if (item.delta === null || item.delta === "" || Number.isNaN(delta)) throw new AppError("delta must be a number", 400)
    out.delta = delta
  }
  if (item.number_of_packs !== undefined) out.number_of_packs = nonNegative(item, "number_of_packs", { integer: true })
  if (item.loose_units !== undefined) out.loose_units = nonNegative(item, "loose_units")
  const ways = ["qty", "delta"].filter((key) => out[key] !== undefined).length + (out.number_of_packs !== undefined || out.loose_units !== undefined ? 1 : 0)
  if (ways > 1) throw new AppError("Send one of qty, delta, or number_of_packs (+ loose_units)", 400)
  if (item.expiry_date !== undefined) {
    if (item.expiry_date === null || item.expiry_date === "") out.expiry_date = null
    else {
      const value = String(item.expiry_date).trim().slice(0, 10)
      if (!DATE_RE.test(value) || Number.isNaN(new Date(value).getTime())) {
        throw new AppError("expiry_date must be YYYY-MM-DD (or null to clear it)", 400)
      }
      out.expiry_date = value
    }
  }
  if (item.low_stock_threshold !== undefined) {
    out.low_stock_threshold = item.low_stock_threshold === null || item.low_stock_threshold === "" ? null : nonNegative(item, "low_stock_threshold")
  }
  if (!ways && out.expiry_date === undefined && out.low_stock_threshold === undefined) {
    throw new AppError("Send qty (or delta / number_of_packs), expiry_date or low_stock_threshold", 400)
  }
  if (item.reason !== undefined && item.reason !== null && item.reason !== "") {
    if (!EDIT_REASONS.includes(item.reason)) throw new AppError(`reason must be one of ${EDIT_REASONS.join(", ")}`, 400)
    out.reason = item.reason
  }
  if (item.movement_type !== undefined && item.movement_type !== null && item.movement_type !== "") {
    if (!EDIT_TYPES.includes(item.movement_type)) throw new AppError(`movement_type must be one of ${EDIT_TYPES.join(", ")}`, 400)
    out.movement_type = item.movement_type
  }
  const note = item.reason_note ?? item.note
  out.reason_note = note == null ? null : String(note).trim() || null
  return out
}

/** DELETE /product-stocks/:id — optional { reason_note }, saved on the movement that zeroes it. */
export function parseDeleteStockEntry(body) {
  const note = body?.reason_note
  return { reason_note: note == null ? null : String(note).trim() || null }
}
