import { AppError } from "../../shared/errors/AppError.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// A location / product reference: its short number (e.g. 1) or its UUID.
function requireRef(body, key) {
  const value = String(body[key] ?? "").trim()
  if (!(/^[1-9][0-9]*$/.test(value) || UUID_RE.test(value))) {
    throw new AppError(key + " must be a number or a UUID", 400)
  }
  return value
}

export function parseCreateTransfer(body) {
  const qty = Number(body.qty)
  if (Number.isNaN(qty) || qty <= 0) {
    throw new AppError("qty must be a number > 0", 400)
  }
  const from_location_id = requireRef(body, "from_location_id")
  const to_location_id = requireRef(body, "to_location_id")
  if (from_location_id === to_location_id) {
    throw new AppError("from and to locations must be different", 400)
  }
  return {
    // The staff member who sent it (PIN-picked); defaults to the signed-in user.
    staff_ref: body.staff_id ?? body.staffId ?? null,
    from_location_id,
    to_location_id,
    product_id: requireRef(body, "product_id"),
    qty,
    note:
      body.note === undefined || body.note === null
        ? null
        : String(body.note).trim(),
  }
}
