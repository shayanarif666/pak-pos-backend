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
  if (qty === undefined && delta === undefined && body.low_stock_threshold === undefined) {
    throw new AppError("qty, delta, or low_stock_threshold is required", 400)
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
  }
}
