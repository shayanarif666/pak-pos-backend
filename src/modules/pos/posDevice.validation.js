import { AppError } from "../../shared/errors/AppError.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

export function parseRegisterDevice(body) {
  let location_id = optionalString(body, "location_id")
  if (location_id && !UUID_RE.test(location_id)) {
    throw new AppError("location_id must be a UUID", 400)
  }
  return {
    device_uid: requireString(body, "device_uid"),
    name: requireString(body, "name"),
    location_id,
    platform: optionalString(body, "platform"),
    app_version: optionalString(body, "app_version"),
    license_key: optionalString(body, "license_key"),
  }
}

export function parsePatchDevice(body) {
  const patch = {}
  if (body.name !== undefined) patch.name = requireString(body, "name")
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active)
  if (body.location_id !== undefined) {
    const location_id = requireString(body, "location_id")
    if (!UUID_RE.test(location_id)) throw new AppError("location_id must be a UUID", 400)
    patch.location_id = location_id
  }
  if (!Object.keys(patch).length) throw new AppError("No fields to update", 400)
  return patch
}
