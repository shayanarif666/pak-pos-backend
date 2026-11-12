import { AppError } from "../../shared/errors/AppError.js"
import { DISCOUNT_TYPE } from "../../db/enums.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function requireText(body, key, { max = 255 } = {}) {
  const value = body[key]
  if (typeof value !== "string" || !value.trim()) throw new AppError(`${key} is required`, 400)
  const trimmed = value.trim()
  if (trimmed.length > max) throw new AppError(`${key} is too long`, 400)
  return trimmed
}

/** A percentage is at most 100 (checked once the type and the value are both known). */
export function assertDiscountFits(type, value) {
  if (type === "percentage" && Number(value) > 100) throw new AppError("A percentage discount cannot be more than 100", 400)
}

/**
 * discount_type + discount_value. On create (required) both must be sent; on a patch either may
 * be sent on its own (the service checks the pair against the saved one).
 */
export function discountPair(body, { required }) {
  const out = {}
  if (required || body.discount_type !== undefined) {
    const type = String(body.discount_type ?? "")
    if (!DISCOUNT_TYPE.includes(type)) throw new AppError("discount_type must be percentage or fixed", 400)
    out.discount_type = type
  }
  if (required || body.discount_value !== undefined) {
    const raw = body.discount_value
    const value = raw === "" || raw === null || raw === undefined ? NaN : Number(raw)
    if (Number.isNaN(value) || value <= 0) throw new AppError("discount_value must be a number greater than 0", 400)
    out.discount_value = value
  }
  if (out.discount_type && out.discount_value !== undefined) assertDiscountFits(out.discount_type, out.discount_value)
  return out
}

export function optionalDate(body, key) {
  if (body[key] === undefined) return undefined
  if (body[key] === null || body[key] === "") return null
  const date = new Date(body[key])
  if (Number.isNaN(date.getTime())) throw new AppError(`${key} is invalid`, 400)
  return date
}

export function assertWindow(start, end) {
  if (start && end && end < start) throw new AppError("end_at must be on or after start_at", 400)
}

/** is_active (true / false) or status ("active" / "inactive"); undefined = not sent. */
export function activeFlag(body) {
  if (body.status !== undefined && body.status !== null && body.status !== "") {
    const status = String(body.status).toLowerCase()
    if (status !== "active" && status !== "inactive") throw new AppError("status must be active or inactive", 400)
    return status === "active"
  }
  if (body.is_active === undefined || body.is_active === null) return undefined
  if (body.is_active === "false" || body.is_active === 0 || body.is_active === "0") return false
  return Boolean(body.is_active)
}

export function boolFlag(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return undefined
  if (body[key] === "false" || body[key] === 0 || body[key] === "0") return false
  return Boolean(body[key])
}

/** A short number (1, 2, 3...) or a UUID, as a string. */
export function ref(value, label) {
  const text = String(value ?? "").trim()
  if ((/^[1-9]\d*$/.test(text)) || UUID_RE.test(text)) return text
  throw new AppError(`${label} must be a number or a UUID`, 400)
}

/** "1,2,3", [1,2,3] or a repeated query key as a list of refs. */
export function refList(value, label) {
  if (value === undefined || value === null || value === "") return []
  const list = Array.isArray(value) ? value : String(value).split(",")
  return [...new Set(list.flatMap((entry) => String(entry).split(",")).map((entry) => entry.trim()).filter(Boolean).map((entry) => ref(entry, label)))]
}

/** The live window: active, started and not ended (view.is_active, view.start_at, view.end_at). */
export function windowIsLive(view, now = new Date()) {
  if (!view.is_active) return false
  if (view.start_at && now < new Date(view.start_at)) return false
  if (view.end_at && now > new Date(view.end_at)) return false
  return true
}

/**
 * ?active= of a discount list: true (or 1) = the live ones (active, started, not ended), false (or 0) = the
 * ones that are not live, left out = every one. ?pos=1 (older clients) = the live ones. undefined = not sent.
 */
export function liveFlag(query = {}) {
  const raw = query.active ?? (query.pos === "1" ? "true" : undefined)
  if (raw === undefined || raw === null || raw === "" || raw === "null") return undefined
  const text = String(raw).toLowerCase()
  if (text === "true" || text === "1") return true
  if (text === "false" || text === "0") return false
  throw new AppError("active must be true, false or left out", 400)
}
