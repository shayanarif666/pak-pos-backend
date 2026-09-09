import { AppError } from "../../shared/errors/AppError.js"
import { BILLING_STATUS, BUSINESS_TYPE } from "../../db/enums.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

function optionalBool(body, key, fallback) {
  if (body[key] === undefined) return fallback
  return Boolean(body[key])
}

function requirePin(body, key) {
  const pin = requireString(body, key, { min: 4, max: 6 })
  if (!/^\d+$/.test(pin)) throw new AppError(`${key} must be 4–6 digits`, 400)
  return pin
}

function requireUuid(body, key) {
  const value = String(body[key] || "").trim()
  if (!UUID_RE.test(value)) throw new AppError(`${key} must be a UUID`, 400)
  return value
}

export function parseRegisterSuperAdmin(body) {
  return {
    name: requireString(body, "name"),
    email: requireString(body, "email").toLowerCase(),
    password: requireString(body, "password", { min: 6, max: 128 }),
    pin: requirePin(body, "pin"),
  }
}

export function parseRegisterStore(body) {
  const admin_email = requireString(body, "admin_email").toLowerCase()
  const manager_email = requireString(body, "manager_email").toLowerCase()
  if (admin_email === manager_email) {
    throw new AppError("admin_email and manager_email must be different", 400)
  }
  const admin_pin = requirePin(body, "admin_pin")
  const manager_pin = requirePin(body, "manager_pin")
  if (admin_pin === manager_pin) {
    throw new AppError("admin_pin and manager_pin must be different", 400)
  }

  const billing_status = body.billing_status
    ? String(body.billing_status)
    : "pending"
  if (!BILLING_STATUS.includes(billing_status)) {
    throw new AppError("billing_status must be pending, paid, failed, or refunded", 400)
  }

  const business_type = requireString(body, "business_type")
  if (!BUSINESS_TYPE.includes(business_type)) {
    throw new AppError(
      "business_type must be grocery, boutique, retail, or pharmacy",
      400
    )
  }

  let amount
  if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
    amount = Number(body.amount)
    if (Number.isNaN(amount) || amount < 0) {
      throw new AppError("amount must be a number >= 0", 400)
    }
  }

  return {
    plan_id: requireUuid(body, "plan_id"),
    name: requireString(body, "name"),
    legal_name: optionalString(body, "legal_name"),
    owner_name: optionalString(body, "owner_name"),
    business_type,
    address: requireString(body, "address"),
    city: optionalString(body, "city"),
    contact_email: requireString(body, "contact_email"),
    contact_phone: requireString(body, "contact_phone"),
    logo_url: optionalString(body, "logo_url"),
    favicon_url: optionalString(body, "favicon_url"),
    location_name: requireString(body, "location_name"),
    location_address: optionalString(body, "location_address"),
    location_city: optionalString(body, "location_city"),
    location_phone: optionalString(body, "location_phone") || requireString(body, "contact_phone"),
    admin_name: requireString(body, "admin_name"),
    admin_email,
    admin_phone: optionalString(body, "admin_phone"),
    admin_password: requireString(body, "admin_password", { min: 6, max: 128 }),
    admin_pin,
    manager_name: requireString(body, "manager_name"),
    manager_email,
    manager_phone: optionalString(body, "manager_phone"),
    manager_password: requireString(body, "manager_password", { min: 6, max: 128 }),
    manager_pin,
    pos_enabled: optionalBool(body, "pos_enabled", true),
    web_enabled: optionalBool(body, "web_enabled", true),
    billing_status,
    amount,
    method_note: optionalString(body, "method_note"),
    billing_note: optionalString(body, "billing_note"),
  }
}

export function parsePatchStore(body) {
  const patch = {}
  const strings = [
    "name",
    "contact_email",
    "contact_phone",
    "suspend_reason",
    "account_manager_name",
    "account_manager_phone",
  ]
  for (const key of strings) {
    if (body[key] !== undefined) patch[key] = optionalString(body, key)
  }
  for (const key of ["is_active", "is_live", "pos_enabled", "web_enabled"]) {
    if (body[key] !== undefined) patch[key] = Boolean(body[key])
  }
  return patch
}

export function parseRevoke(body) {
  return { revoked_reason: optionalString(body, "revoked_reason") }
}

export function parseCreateLicense(body) {
  return {
    store_id: requireUuid(body, "store_id"),
    plan_id: body.plan_id ? requireUuid(body, "plan_id") : null,
  }
}

export function parsePatchLicense(body) {
  const patch = {}
  if (body.plan_id !== undefined) patch.plan_id = requireUuid(body, "plan_id")
  if (body.expires_at !== undefined) {
    const date = new Date(body.expires_at)
    if (Number.isNaN(date.getTime())) throw new AppError("expires_at is invalid", 400)
    patch.expires_at = date
  }
  if (body.revoked_reason !== undefined) {
    patch.revoked_reason = optionalString(body, "revoked_reason")
  }
  if (!Object.keys(patch).length) throw new AppError("No fields to update", 400)
  return patch
}

export function parseAdminDevice(body) {
  return {
    store_id: requireUuid(body, "store_id"),
    location_id: requireUuid(body, "location_id"),
    device_uid: requireString(body, "device_uid"),
    name: requireString(body, "name"),
    platform: optionalString(body, "platform"),
    app_version: optionalString(body, "app_version"),
  }
}
