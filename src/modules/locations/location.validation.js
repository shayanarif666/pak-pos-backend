import { AppError } from "../../shared/errors/AppError.js"

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
  if (body[key] === undefined || body[key] === null || body[key] === "") {
    return null
  }
  if (typeof body[key] !== "string") {
    throw new AppError(`${key} must be a string`, 400)
  }
  return body[key].trim()
}

function requirePin(body, key) {
  const pin = requireString(body, key, { min: 4, max: 6 })
  if (!/^\d+$/.test(pin)) throw new AppError(`${key} must be 4–6 digits`, 400)
  return pin
}

export function parseCreateLocation(body) {
  return {
    name: requireString(body, "name"),
    address_line: requireString(body, "address_line"),
    city: requireString(body, "city"),
    postal_code: optionalString(body, "postal_code"),
    phone: optionalString(body, "phone"),
    is_active: body.is_active === undefined ? true : Boolean(body.is_active),
    is_default: body.is_default === undefined ? false : Boolean(body.is_default),
    manager: {
      name: requireString(body, "manager_name"),
      email: requireString(body, "manager_email").toLowerCase(),
      password: requireString(body, "manager_password", { min: 6, max: 128 }),
      pin: requirePin(body, "manager_pin"),
      phone: optionalString(body, "manager_phone"),
    },
  }
}

export function parsePatchLocation(body) {
  const fields = {}
  if (body.name !== undefined) fields.name = requireString(body, "name")
  if (body.address_line !== undefined) {
    fields.address_line = requireString(body, "address_line")
  }
  if (body.city !== undefined) fields.city = requireString(body, "city")
  if (body.postal_code !== undefined) {
    fields.postal_code = optionalString(body, "postal_code")
  }
  if (body.phone !== undefined) fields.phone = optionalString(body, "phone")
  if (body.is_active !== undefined) fields.is_active = Boolean(body.is_active)
  if (body.is_default !== undefined) fields.is_default = Boolean(body.is_default)

  const hasManagerField =
    body.manager_name !== undefined ||
    body.manager_email !== undefined ||
    body.manager_password !== undefined ||
    body.manager_pin !== undefined ||
    body.manager_phone !== undefined ||
    body.manager_is_active !== undefined

  if (hasManagerField) {
    const manager = {}
    if (body.manager_name !== undefined) {
      manager.name = requireString(body, "manager_name")
    }
    if (body.manager_email !== undefined) {
      manager.email = requireString(body, "manager_email").toLowerCase()
    }
    if (body.manager_password !== undefined && body.manager_password !== "") {
      manager.password = requireString(body, "manager_password", { min: 6, max: 128 })
    }
    if (body.manager_pin !== undefined && body.manager_pin !== "") {
      manager.pin = requirePin(body, "manager_pin")
    }
    if (body.manager_phone !== undefined) {
      manager.phone = optionalString(body, "manager_phone")
    }
    if (body.manager_is_active !== undefined) {
      manager.is_active = Boolean(body.manager_is_active)
    }
    fields.manager = manager
  }

  if (!Object.keys(fields).length) {
    throw new AppError("No fields to update", 400)
  }
  return fields
}
