import { AppError } from "../../shared/errors/AppError.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function optionalString(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  return String(body[key]).trim()
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
  if (!device_uid) {
    return { license_key }
  }

  const name = optionalString(body, "name")
  return {
    license_key,
    device_uid,
    name: name || `POS ${device_uid}`,
    location_id: optionalUuid(body, "location_id"),
    platform: optionalString(body, "platform"),
    app_version: optionalString(body, "app_version"),
  }
}
