import { AppError } from "../../shared/errors/AppError.js"

function requireString(body, key) {
  const value = body[key]
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError(`${key} is required`, 400)
  }
  return value.trim()
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

export function parseCreateLocation(body) {
  return {
    name: requireString(body, "name"),
    address_line: requireString(body, "address_line"),
    city: requireString(body, "city"),
    postal_code: optionalString(body, "postal_code"),
    phone: optionalString(body, "phone"),
    is_active: body.is_active === undefined ? true : Boolean(body.is_active),
    is_default: body.is_default === undefined ? false : Boolean(body.is_default),
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
  return fields
}
