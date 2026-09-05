import { AppError } from "../../shared/errors/AppError.js"

function requireString(body, key, { max = 255 } = {}) {
  const value = body[key]
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError(`${key} is required`, 400)
  }
  const trimmed = value.trim()
  if (trimmed.length > max) throw new AppError(`${key} is too long`, 400)
  return trimmed
}

function optionalString(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  return String(body[key]).trim()
}

export function parseCreateAddress(body) {
  return {
    name: requireString(body, "name", { max: 255 }),
    phone: requireString(body, "phone", { max: 64 }),
    address_line: requireString(body, "address_line", { max: 1000 }),
    city: requireString(body, "city", { max: 255 }),
    postal_code: optionalString(body, "postal_code"),
    is_default: Boolean(body.is_default),
  }
}

export function parsePatchAddress(body) {
  const fields = {}
  for (const key of ["name", "phone", "address_line", "city", "postal_code"]) {
    if (body[key] !== undefined) {
      fields[key] = key === "postal_code" ? optionalString(body, key) : requireString(body, key)
    }
  }
  if (body.is_default !== undefined) fields.is_default = Boolean(body.is_default)
  if (!Object.keys(fields).length) throw new AppError("No fields to update", 400)
  return fields
}
