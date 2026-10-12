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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function optionalUuid(body, key) {
  const value = optionalString(body, key)
  if (!value) return null
  if (!UUID_RE.test(value)) throw new AppError(`${key} must be a UUID`, 400)
  return value
}

// Login takes credentials + channel: { email, password, channel } or { pin, channel }, plus an
// optional device hint on POS so the response can echo back which till just signed in — either
// device_id (the pos_devices row id) or device_uid (the till's own stable hardware id, known
// right after license activation). Store and license are resolved on the server either way;
// anything else in the body is ignored.
export function parseLogin(body) {
  const email = optionalString(body, "email")
  const password = optionalString(body, "password")
  const pin = optionalPin(body, "pin")
  const device_id = optionalUuid(body, "device_id")
  const device_uid = optionalString(body, "device_uid")

  const channel = optionalString(body, "channel")
  if (channel && !ORDER_CHANNEL.includes(channel)) {
    throw new AppError("channel must be web or pos", 400)
  }

  if (pin) {
    if (email || password) {
      throw new AppError("Use email and password, or pin only", 400)
    }
    // PIN sign-in exists only on the POS.
    if (channel && channel !== "pos") {
      throw new AppError("PIN login is only available on POS", 400)
    }
    return { email: null, password: null, pin, channel: "pos", device_id, device_uid }
  }

  if (!email) throw new AppError("email is required", 400)
  if (!password) throw new AppError("password is required", 400)
  return {
    email: email.toLowerCase(),
    password,
    pin: null,
    channel: channel || "web",
    device_id,
    device_uid,
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
