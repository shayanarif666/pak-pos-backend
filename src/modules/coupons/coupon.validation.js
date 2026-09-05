import { AppError } from "../../shared/errors/AppError.js"
import { DISCOUNT_TYPE, ORDER_CHANNEL } from "../../db/enums.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function requireString(body, key, { min = 1, max = 64 } = {}) {
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

function optionalUuid(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  const value = String(body[key])
  if (!UUID_RE.test(value)) throw new AppError(`${key} must be a UUID`, 400)
  return value
}

function optionalDate(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  const date = new Date(body[key])
  if (Number.isNaN(date.getTime())) throw new AppError(`${key} is invalid`, 400)
  return date
}

function requireNumber(body, key, { min = 0 } = {}) {
  if (body[key] === undefined || body[key] === null || body[key] === "") {
    throw new AppError(`${key} is required`, 400)
  }
  const n = Number(body[key])
  if (Number.isNaN(n) || n < min) {
    throw new AppError(`${key} must be a number >= ${min}`, 400)
  }
  return n
}

function optionalNumber(body, key, { min = 0 } = {}) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  const n = Number(body[key])
  if (Number.isNaN(n) || n < min) {
    throw new AppError(`${key} must be a number >= ${min}`, 400)
  }
  return n
}

function optionalInt(body, key, { min = 1 } = {}) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  const n = Number(body[key])
  if (!Number.isInteger(n) || n < min) {
    throw new AppError(`${key} must be an integer >= ${min}`, 400)
  }
  return n
}

function requireDiscountType(body) {
  const type = String(body.type || "")
  if (!DISCOUNT_TYPE.includes(type)) {
    throw new AppError("type must be percentage or fixed", 400)
  }
  return type
}

function normalizeCode(value) {
  return String(value).trim().toUpperCase()
}

function assertWindow(start_date, end_date) {
  if (start_date && end_date && end_date < start_date) {
    throw new AppError("end_date must be on or after start_date", 400)
  }
}

function assertValue(type, value) {
  if (type === "percentage" && value > 100) {
    throw new AppError("percentage value cannot exceed 100", 400)
  }
  if (value <= 0) throw new AppError("value must be > 0", 400)
}

export function parseCreateCoupon(body) {
  const type = requireDiscountType(body)
  const value = requireNumber(body, "value", { min: 0 })
  assertValue(type, value)
  const fields = {
    code: normalizeCode(requireString(body, "code", { min: 2, max: 64 })),
    type,
    value,
    location_id: optionalUuid(body, "location_id"),
    min_order_amount: optionalNumber(body, "min_order_amount") ?? 0,
    start_date: optionalDate(body, "start_date"),
    end_date: optionalDate(body, "end_date"),
    usage_limit: optionalInt(body, "usage_limit"),
    is_active: body.is_active === undefined ? true : Boolean(body.is_active),
    pos_enabled: body.pos_enabled === undefined ? false : Boolean(body.pos_enabled),
    web_enabled: body.web_enabled === undefined ? true : Boolean(body.web_enabled),
  }
  assertWindow(fields.start_date, fields.end_date)
  return fields
}

export function parsePatchCoupon(body) {
  const patch = {}
  if (body.code !== undefined) {
    patch.code = normalizeCode(requireString(body, "code", { min: 2, max: 64 }))
  }
  if (body.type !== undefined) patch.type = requireDiscountType(body)
  if (body.value !== undefined) patch.value = requireNumber(body, "value")
  if (body.location_id !== undefined) patch.location_id = optionalUuid(body, "location_id")
  if (body.min_order_amount !== undefined) {
    patch.min_order_amount = optionalNumber(body, "min_order_amount") ?? 0
  }
  if (body.start_date !== undefined) patch.start_date = optionalDate(body, "start_date")
  if (body.end_date !== undefined) patch.end_date = optionalDate(body, "end_date")
  if (body.usage_limit !== undefined) patch.usage_limit = optionalInt(body, "usage_limit")
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active)
  if (body.pos_enabled !== undefined) patch.pos_enabled = Boolean(body.pos_enabled)
  if (body.web_enabled !== undefined) patch.web_enabled = Boolean(body.web_enabled)
  if (!Object.keys(patch).length) throw new AppError("No fields to update", 400)
  return patch
}

export function parseValidateCoupon(body) {
  const channel = String(body.channel || "")
  if (!ORDER_CHANNEL.includes(channel)) {
    throw new AppError("channel must be web or pos", 400)
  }
  return {
    code: normalizeCode(requireString(body, "code", { min: 2, max: 64 })),
    order_total: requireNumber(body, "order_total"),
    channel,
    location_id: optionalUuid(body, "location_id"),
  }
}
