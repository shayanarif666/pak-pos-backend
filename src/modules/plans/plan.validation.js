import { AppError } from "../../shared/errors/AppError.js"
import { PLAN_CODE } from "../../db/enums.js"

const BOOL_KEYS = [
  "offline_enabled",
  "pin_override_enabled",
  "approval_enabled",
  "advanced_reports",
  "backup_restore_enabled",
  "multi_branch_enabled",
  "has_dedicated_am",
  "is_active",
]

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

export function parseCreatePlan(body) {
  const fields = {
    code: requireCode(body),
    name: requireString(body, "name"),
    price_pkr: requireNumber(body, "price_pkr", { min: 0 }),
    max_devices: requireNumber(body, "max_devices", { min: 1, integer: true }),
    max_locations: requireNumber(body, "max_locations", { min: 1, integer: true }),
  }
  for (const key of BOOL_KEYS) {
    if (body[key] !== undefined) fields[key] = Boolean(body[key])
  }
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
  for (const key of BOOL_KEYS) {
    const value = optionalBool(body, key)
    if (value !== undefined) fields[key] = value
  }
  if (!Object.keys(fields).length) throw new AppError("No fields to update", 400)
  return fields
}
