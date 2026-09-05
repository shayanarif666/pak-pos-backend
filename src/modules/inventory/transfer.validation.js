import { AppError } from "../../shared/errors/AppError.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function requireUuid(body, key) {
  const value = String(body[key] || "")
  if (!UUID_RE.test(value)) throw new AppError(`${key} must be a UUID`, 400)
  return value
}

export function parseCreateTransfer(body) {
  const qty = Number(body.qty)
  if (Number.isNaN(qty) || qty <= 0) {
    throw new AppError("qty must be a number > 0", 400)
  }
  const from_location_id = requireUuid(body, "from_location_id")
  const to_location_id = requireUuid(body, "to_location_id")
  if (from_location_id === to_location_id) {
    throw new AppError("from and to locations must be different", 400)
  }
  return {
    from_location_id,
    to_location_id,
    product_id: requireUuid(body, "product_id"),
    qty,
    note:
      body.note === undefined || body.note === null
        ? null
        : String(body.note).trim(),
  }
}
