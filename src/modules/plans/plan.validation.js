import { AppError } from "../../shared/errors/AppError.js"
import { PLAN_CODE } from "../../db/enums.js"

function requireString(body, key, { max = 255 } = {}) {
  const value = body[key]
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError(`${key} is required`, 400)
  }
  const trimmed = value.trim()
  if (trimmed.length > max) throw new AppError(`${key} is too long`, 400)
  return trimmed
}

function requireCode(body) {
  const code = String(body.code || "").trim()
  if (!PLAN_CODE.includes(code)) {
    throw new AppError("code must be package_1, package_2, or package_3", 400)
  }
  return code
}

function requireNumber(body, key, { min = 0, integer = false } = {}) {
  if (body[key] === undefined || body[key] === null || body[key] === "") {
    throw new AppError(`${key} is required`, 400)
  }
  const n = Number(body[key])
  if (Number.isNaN(n) || n < min) {
    throw new AppError(`${key} must be a number >= ${min}`, 400)
  }
  if (integer && !Number.isInteger(n)) {
    throw new AppError(`${key} must be an integer`, 400)
  }
  return n
}

function optionalNumber(body, key, { min = 0, integer = false } = {}) {
  if (body[key] === undefined) return undefined
  return requireNumber(body, key, { min, integer })
}

function optionalBool(body, key) {
  if (body[key] === undefined) return undefined
  return Boolean(body[key])
}

export function parseFeatures(value, { required = false } = {}) {
  if (value === undefined) {
    if (required) throw new AppError("features is required", 400)
    return undefined
  }
  if (value === null) return []
  if (!Array.isArray(value)) {
    throw new AppError("features must be an array of strings", 400)
  }
  if (value.length > 50) throw new AppError("features cannot have more than 50 items", 400)

  const seen = new Set()
  const features = []
  for (const item of value) {
    let text = ""
    if (typeof item === "string") text = item.trim()
    else if (item && typeof item === "object") {
      text = String(item.label || item.key || item.name || "").trim()
    } else {
      throw new AppError("each feature must be a string", 400)
    }
    if (!text) continue
    if (text.length > 200) throw new AppError("each feature must be at most 200 characters", 400)
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    features.push(text)
  }
  return features
}

export function parseCreatePlan(body) {
  const fields = {
    code: requireCode(body),
    name: requireString(body, "name"),
    price_pkr: requireNumber(body, "price_pkr", { min: 0 }),
    max_devices: requireNumber(body, "max_devices", { min: 1, integer: true }),
    max_locations: requireNumber(body, "max_locations", { min: 1, integer: true }),
    features: parseFeatures(body.features) ?? [],
  }
  const is_active = optionalBool(body, "is_active")
  if (is_active !== undefined) fields.is_active = is_active
  return fields
}

export function parsePatchPlan(body) {
  const fields = {}
  if (body.name !== undefined) fields.name = requireString(body, "name")
  const price = optionalNumber(body, "price_pkr", { min: 0 })
  if (price !== undefined) fields.price_pkr = price
  const devices = optionalNumber(body, "max_devices", { min: 1, integer: true })
  if (devices !== undefined) fields.max_devices = devices
  const locations = optionalNumber(body, "max_locations", { min: 1, integer: true })
  if (locations !== undefined) fields.max_locations = locations
  const features = parseFeatures(body.features)
  if (features !== undefined) fields.features = features
  const is_active = optionalBool(body, "is_active")
  if (is_active !== undefined) fields.is_active = is_active
  if (!Object.keys(fields).length) throw new AppError("No fields to update", 400)
  return fields
}
