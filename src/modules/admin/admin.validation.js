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

export function parseBulkDelete(body) {
  if (!Array.isArray(body.ids) || !body.ids.length) {
    throw new AppError("ids must be a non-empty array of UUIDs", 400)
  }
  const ids = [...new Set(body.ids.map((id) => String(id).trim()).filter(Boolean))]
  if (!ids.length) throw new AppError("ids must be a non-empty array of UUIDs", 400)
  for (const id of ids) {
    if (!UUID_RE.test(id)) throw new AppError("each id must be a UUID", 400)
  }
  return { ids }
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
    custom_domain: optionalString(body, "domain") || optionalString(body, "custom_domain"),
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

function optionalPinIfPresent(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return undefined
  return requirePin(body, key)
}

function optionalPasswordIfPresent(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return undefined
  return requireString(body, key, { min: 6, max: 128 })
}

function optionalUuidIfPresent(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return undefined
  return requireUuid(body, key)
}

function optionalAmountIfPresent(body) {
  if (body.amount === undefined || body.amount === null || body.amount === "") return undefined
  const amount = Number(body.amount)
  if (Number.isNaN(amount) || amount < 0) {
    throw new AppError("amount must be a number >= 0", 400)
  }
  return amount
}

function optionalBillingStatusIfPresent(body) {
  if (body.billing_status === undefined || body.billing_status === null || body.billing_status === "") {
    return undefined
  }
  const billing_status = String(body.billing_status)
  if (!BILLING_STATUS.includes(billing_status)) {
    throw new AppError("billing_status must be pending, paid, failed, or refunded", 400)
  }
  return billing_status
}

function optionalBusinessTypeIfPresent(body) {
  if (body.business_type === undefined || body.business_type === null || body.business_type === "") {
    return undefined
  }
  const business_type = String(body.business_type)
  if (!BUSINESS_TYPE.includes(business_type)) {
    throw new AppError(
      "business_type must be grocery, boutique, retail, or pharmacy",
      400
    )
  }
  return business_type
}

function optionalBoolIfPresent(body, key) {
  if (body[key] === undefined) return undefined
  if (body[key] === "false" || body[key] === "0") return false
  return Boolean(body[key])
}

export function parsePatchStore(body) {
  const patch = {}
  const plan_id = optionalUuidIfPresent(body, "plan_id")
  if (plan_id) patch.plan_id = plan_id

  const requiredIfPresent = [
    "name",
    "address",
    "contact_email",
    "contact_phone",
    "location_name",
    "admin_name",
    "admin_email",
    "manager_name",
    "manager_email",
  ]
  for (const key of requiredIfPresent) {
    if (body[key] !== undefined) patch[key] = requireString(body, key)
  }
  if (patch.admin_email) patch.admin_email = patch.admin_email.toLowerCase()
  if (patch.manager_email) patch.manager_email = patch.manager_email.toLowerCase()

  const optionalKeys = [
    "legal_name",
    "owner_name",
    "city",
    "logo_url",
    "favicon_url",
    "location_address",
    "location_city",
    "location_phone",
    "admin_phone",
    "manager_phone",
    "method_note",
    "billing_note",
    "suspend_reason",
    "account_manager_name",
    "account_manager_phone",
  ]
  for (const key of optionalKeys) {
    if (body[key] !== undefined) patch[key] = optionalString(body, key)
  }

  if (body.domain !== undefined || body.custom_domain !== undefined) {
    patch.custom_domain =
      optionalString(body, "domain") || optionalString(body, "custom_domain")
  }

  const business_type = optionalBusinessTypeIfPresent(body)
  if (business_type) patch.business_type = business_type

  const billing_status = optionalBillingStatusIfPresent(body)
  if (billing_status) patch.billing_status = billing_status

  const amount = optionalAmountIfPresent(body)
  if (amount !== undefined) patch.amount = amount

  const admin_password = optionalPasswordIfPresent(body, "admin_password")
  if (admin_password) patch.admin_password = admin_password
  const manager_password = optionalPasswordIfPresent(body, "manager_password")
  if (manager_password) patch.manager_password = manager_password

  const admin_pin = optionalPinIfPresent(body, "admin_pin")
  if (admin_pin) patch.admin_pin = admin_pin
  const manager_pin = optionalPinIfPresent(body, "manager_pin")
  if (manager_pin) patch.manager_pin = manager_pin

  if (patch.admin_email && patch.manager_email && patch.admin_email === patch.manager_email) {
    throw new AppError("admin_email and manager_email must be different", 400)
  }
  if (patch.admin_pin && patch.manager_pin && patch.admin_pin === patch.manager_pin) {
    throw new AppError("admin_pin and manager_pin must be different", 400)
  }

  for (const key of ["is_active", "is_live", "pos_enabled", "web_enabled"]) {
    const value = optionalBoolIfPresent(body, key)
    if (value !== undefined) patch[key] = value
  }

  if (!Object.keys(patch).length) throw new AppError("No fields to update", 400)
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
