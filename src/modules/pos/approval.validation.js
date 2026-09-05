import { AppError } from "../../shared/errors/AppError.js"
import { APPROVAL_STATUS, APPROVAL_TYPE } from "../../db/enums.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function optionalUuid(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  const value = String(body[key])
  if (!UUID_RE.test(value)) throw new AppError(`${key} must be a UUID`, 400)
  return value
}

function optionalString(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  return String(body[key]).trim()
}

export function parseCreateApproval(body) {
  const type = String(body.type || "")
  if (!APPROVAL_TYPE.includes(type)) {
    throw new AppError("Invalid approval type", 400)
  }
  return {
    type,
    order_id: optionalUuid(body, "order_id"),
    location_id: optionalUuid(body, "location_id"),
    reason: optionalString(body, "reason"),
    payload: body.payload && typeof body.payload === "object" ? body.payload : null,
  }
}

export function parseReviewApproval(body) {
  const status = String(body.status || "")
  if (!["approved", "rejected"].includes(status)) {
    throw new AppError("status must be approved or rejected", 400)
  }
  return {
    status,
    review_note: optionalString(body, "review_note"),
    pin: optionalString(body, "pin"),
  }
}

export function parsePinOverride(body) {
  const pin = String(body.pin || "")
  if (!/^\d{4,6}$/.test(pin)) throw new AppError("pin must be 4–6 digits", 400)
  const type = String(body.type || "pin_override")
  if (!APPROVAL_TYPE.includes(type)) throw new AppError("Invalid approval type", 400)
  return {
    pin,
    type,
    order_id: optionalUuid(body, "order_id"),
    location_id: optionalUuid(body, "location_id"),
    reason: optionalString(body, "reason"),
    payload: body.payload && typeof body.payload === "object" ? body.payload : null,
  }
}

export { APPROVAL_STATUS }
