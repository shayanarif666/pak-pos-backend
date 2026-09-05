import { AppError } from "../../shared/errors/AppError.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const STAFF_ROLES = ["manager", "cashier"]

function requireString(body, key, { min = 1, max = 500 } = {}) {
  const value = body[key]
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError(`${key} is required`, 400)
  }
  const trimmed = value.trim()
  if (trimmed.length < min || trimmed.length > max) {
    throw new AppError(`${key} length is invalid`, 400)
  }
  return trimmed
}

function optionalString(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  return String(body[key]).trim()
}

function requirePin(body, key) {
  const pin = requireString(body, key, { min: 4, max: 6 })
  if (!/^\d+$/.test(pin)) throw new AppError(`${key} must be 4–6 digits`, 400)
  return pin
}

function optionalUuid(body, key) {
  const value = optionalString(body, key)
  if (!value) return null
  if (!UUID_RE.test(value)) throw new AppError(`${key} must be a UUID`, 400)
  return value
}

export function parseCreateStaff(body) {
  const role = requireString(body, "role")
  if (!STAFF_ROLES.includes(role)) {
    throw new AppError("role must be manager or cashier", 400)
  }

  return {
    name: requireString(body, "name"),
    email: requireString(body, "email").toLowerCase(),
    password: requireString(body, "password", { min: 6, max: 128 }),
    pin: requirePin(body, "pin"),
    role,
    phone: optionalString(body, "phone"),
    location_id: optionalUuid(body, "location_id"),
  }
}

export function parsePatchStaff(body) {
  const patch = {}
  if (body.name !== undefined) patch.name = requireString(body, "name")
  if (body.phone !== undefined) patch.phone = optionalString(body, "phone")
  if (body.password !== undefined) {
    patch.password = requireString(body, "password", { min: 6, max: 128 })
  }
  if (body.pin !== undefined) patch.pin = requirePin(body, "pin")
  if (body.location_id !== undefined) {
    const location_id = optionalUuid(body, "location_id")
    if (!location_id) throw new AppError("location_id must be a UUID", 400)
    patch.location_id = location_id
  }
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active)
  if (body.role !== undefined) {
    if (!STAFF_ROLES.includes(body.role)) {
      throw new AppError("role must be manager or cashier", 400)
    }
    patch.role = body.role
  }
  if (!Object.keys(patch).length) {
    throw new AppError("No fields to update", 400)
  }
  return patch
}
