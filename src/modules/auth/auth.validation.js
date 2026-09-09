import { AppError } from "../../shared/errors/AppError.js"
import { ORDER_CHANNEL } from "../../db/enums.js"

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

function optionalPin(body, key) {
  const pin = optionalString(body, key)
  if (!pin) return null
  if (!/^\d{4,6}$/.test(pin)) throw new AppError(`${key} must be 4–6 digits`, 400)
  return pin
}

export function parseLogin(body) {
  const email = optionalString(body, "email")
  const password = optionalString(body, "password")
  const pin = optionalPin(body, "pin")

  if (pin) {
    if (email || password) {
      throw new AppError("Use email and password, or pin only", 400)
    }
  } else {
    if (!email) throw new AppError("email is required", 400)
    if (!password) throw new AppError("password is required", 400)
  }

  const channel = optionalString(body, "channel")
  if (channel && !ORDER_CHANNEL.includes(channel)) {
    throw new AppError("channel must be web or pos", 400)
  }

  const license_key = optionalString(body, "license_key")
  if (channel === "pos" && !license_key) {
    throw new AppError("license_key is required for POS login", 400)
  }

  return {
    email: email ? email.toLowerCase() : null,
    password,
    pin,
    channel,
    license_key,
    store_slug: optionalString(body, "store_slug"),
  }
}

export function parseRefresh(body) {
  return {
    refresh_token: requireString(body, "refresh_token"),
  }
}

export function parseRegisterCustomer(body) {
  return {
    store_slug: requireString(body, "store_slug"),
    name: requireString(body, "name"),
    email: requireString(body, "email").toLowerCase(),
    password: requireString(body, "password", { min: 6, max: 128 }),
    phone: optionalString(body, "phone"),
  }
}

export function parsePatchMe(body) {
  const patch = {}
  if (body.name !== undefined) patch.name = requireString(body, "name")
  if (body.phone !== undefined) patch.phone = optionalString(body, "phone")
  if (body.password !== undefined) {
    patch.current_password = requireString(body, "current_password")
    patch.password = requireString(body, "password", { min: 6, max: 128 })
  }
  if (body.pin !== undefined) {
    const pin = optionalPin(body, "pin")
    if (!pin) throw new AppError("pin must be 4–6 digits", 400)
    patch.pin = pin
  }
  if (!Object.keys(patch).length) {
    throw new AppError("No fields to update", 400)
  }
  return patch
}

export function parseForgotPassword(body) {
  return {
    email: requireString(body, "email").toLowerCase(),
    store_slug: optionalString(body, "store_slug"),
    license_key: optionalString(body, "license_key"),
  }
}

export function parseResetPassword(body) {
  return {
    token: requireString(body, "token"),
    password: requireString(body, "password", { min: 6, max: 128 }),
  }
}

export function parseVerifyEmail(body) {
  return {
    token: requireString(body, "token"),
  }
}
