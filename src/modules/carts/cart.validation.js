import { AppError } from "../../shared/errors/AppError.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function optionalString(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  return String(body[key]).trim()
}

function requireUuid(body, key) {
  const value = String(body[key] || "")
  if (!UUID_RE.test(value)) throw new AppError(`${key} must be a UUID`, 400)
  return value
}

function requireQty(body) {
  const quantity = Number(body.quantity ?? body.weight)
  if (Number.isNaN(quantity) || quantity <= 0) {
    throw new AppError("quantity must be > 0", 400)
  }
  return quantity
}

export function parsePutCart(body) {
  return {
    coupon_code: optionalString(body, "coupon_code"),
  }
}

export function parseAddCartItem(body) {
  return {
    product_id: requireUuid(body, "product_id"),
    quantity: requireQty(body),
    weight: body.weight == null || body.weight === "" ? null : Number(body.weight),
  }
}

export function parsePatchCartItem(body) {
  const fields = {}
  if (body.quantity !== undefined || body.weight !== undefined) {
    fields.quantity = requireQty(body)
  }
  if (body.weight !== undefined) {
    fields.weight =
      body.weight == null || body.weight === "" ? null : Number(body.weight)
  }
  if (!Object.keys(fields).length) {
    throw new AppError("quantity or weight is required", 400)
  }
  return fields
}
