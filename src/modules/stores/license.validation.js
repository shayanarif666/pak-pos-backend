import { AppError } from "../../shared/errors/AppError.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

function optionalUuid(body, key) {
  const value = optionalString(body, key)
  if (!value) return null
  if (!UUID_RE.test(value)) throw new AppError(`${key} must be a UUID`, 400)
  return value
}

export function parseValidateLicense(body) {
  const license_key = optionalString(body, "license_key")
  if (!license_key) throw new AppError("license_key is required", 400)

  const device_uid = optionalString(body, "device_uid")
  const name = optionalString(body, "name")
  const email = optionalString(body, "email")
  const password = optionalString(body, "password")
  const pin = optionalPin(body, "pin")
  const wantsDevice = Boolean(device_uid || name || email || password || pin)

  if (!wantsDevice) {
    return { license_key }
  }

  if (!device_uid) throw new AppError("device_uid is required to register this POS", 400)
  if (!email) throw new AppError("email is required to activate a POS device", 400)
  if (password && pin) throw new AppError("Send password or pin, not both", 400)
  if (!password && !pin) throw new AppError("password or pin is required to activate a POS device", 400)

  return {
    license_key,
    device_uid,
    name: name || `POS ${device_uid}`,
    email: email.toLowerCase(),
    password,
    pin,
    location_id: optionalUuid(body, "location_id"),
    platform: optionalString(body, "platform"),
    app_version: optionalString(body, "app_version"),
  }
}
