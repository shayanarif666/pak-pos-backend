import { AppError } from "../../shared/errors/AppError.js"
import { STOCK_MOVEMENT_REASON } from "../../db/enums.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const MANUAL_TYPES = ["stock_in", "stock_out", "adjustment"]
const MANUAL_REASONS = STOCK_MOVEMENT_REASON.filter(
  (reason) => !["sale", "refund", "transfer", "custom_sale"].includes(reason)
)

function requireUuid(body, key) {
  const value = String(body[key] || "")
  if (!UUID_RE.test(value)) throw new AppError(`${key} must be a UUID`, 400)
  return value
}

function optionalUuid(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  return requireUuid(body, key)
}

export function parseCreateMovement(body) {
  const movement_type = String(body.movement_type || "")
  if (!MANUAL_TYPES.includes(movement_type)) {
    throw new AppError(
      "movement_type must be stock_in, stock_out, or adjustment",
      400
    )
  }
  const reason = String(body.reason || "")
  if (!MANUAL_REASONS.includes(reason)) {
    throw new AppError("Invalid stock movement reason", 400)
  }
  const qty = Number(body.qty)
  if (Number.isNaN(qty) || qty === 0) {
    throw new AppError("qty must be a non-zero number", 400)
  }
  if (movement_type === "stock_in" && qty < 0) {
    throw new AppError("stock_in qty must be positive", 400)
  }
  if (movement_type === "stock_out" && qty > 0) {
    throw new AppError("stock_out qty must be negative", 400)
  }

  return {
    product_id: requireUuid(body, "product_id"),
    location_id: optionalUuid(body, "location_id"),
    movement_type,
    reason,
    qty,
    reason_note:
      body.reason_note === undefined || body.reason_note === null
        ? null
        : String(body.reason_note).trim(),
    expiry_date:
      body.expiry_date === undefined || body.expiry_date === null || body.expiry_date === ""
        ? undefined
        : (() => {
            const date = new Date(body.expiry_date)
            if (Number.isNaN(date.getTime())) {
              throw new AppError("expiry_date is invalid", 400)
            }
            return date
          })(),
  }
}
