import { AppError } from "../../shared/errors/AppError.js"
import { DISCOUNT_TYPE, OFFER_APPLY_TO, OFFER_TYPE } from "../../db/enums.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function requireString(body, key, { max = 500 } = {}) {
  const value = body[key]
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError(`${key} is required`, 400)
  }
  const trimmed = value.trim()
  if (trimmed.length > max) throw new AppError(`${key} is too long`, 400)
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

function optionalDiscountType(body) {
  if (body.discount_type === undefined || body.discount_type === null || body.discount_type === "") {
    return null
  }
  const value = String(body.discount_type)
  if (!DISCOUNT_TYPE.includes(value)) {
    throw new AppError("discount_type must be percentage or fixed", 400)
  }
  return value
}

function assertWindow(start_at, end_at) {
  if (start_at && end_at && end_at < start_at) {
    throw new AppError("end_at must be on or after start_at", 400)
  }
}

export function assertOfferRules(fields) {
  if (fields.type === "bogo") {
    if (!fields.buy_qty || !fields.get_qty) {
      throw new AppError("bogo requires buy_qty and get_qty", 400)
    }
    if (fields.discount_type || fields.discount_value != null) {
      throw new AppError("bogo does not use discount_type or discount_value", 400)
    }
  }

  if (fields.type === "bulk_discount") {
    if (fields.min_qty == null) throw new AppError("bulk_discount requires min_qty", 400)
    if (!fields.discount_type || fields.discount_value == null) {
      throw new AppError("bulk_discount requires discount_type and discount_value", 400)
    }
  }

  if (fields.type === "promotional") {
    if (!fields.discount_type || fields.discount_value == null) {
      throw new AppError("promotional requires discount_type and discount_value", 400)
    }
  }

  if (fields.type === "flash_sale") {
    if (fields.discount_type && fields.discount_value == null) {
      throw new AppError("flash_sale discount_value is required when discount_type is set", 400)
    }
    if (!fields.discount_type && fields.discount_value != null) {
      throw new AppError("flash_sale discount_type is required when discount_value is set", 400)
    }
  }

  if (fields.discount_type === "percentage" && fields.discount_value > 100) {
    throw new AppError("percentage discount_value cannot exceed 100", 400)
  }
}

export function parseCreateOffer(body) {
  const type = String(body.type || "")
  if (!OFFER_TYPE.includes(type)) {
    throw new AppError(
      "type must be flash_sale, bulk_discount, bogo, or promotional",
      400
    )
  }
  const apply_to = String(body.apply_to || "")
  if (!OFFER_APPLY_TO.includes(apply_to)) {
    throw new AppError("apply_to must be product or category", 400)
  }

  const fields = {
    name: requireString(body, "name"),
    type,
    apply_to,
    location_id: optionalUuid(body, "location_id"),
    discount_type: optionalDiscountType(body),
    discount_value: optionalNumber(body, "discount_value"),
    min_qty: optionalNumber(body, "min_qty"),
    buy_qty: optionalInt(body, "buy_qty"),
    get_qty: optionalInt(body, "get_qty"),
    start_at: optionalDate(body, "start_at"),
    end_at: optionalDate(body, "end_at"),
    is_active: body.is_active === undefined ? true : Boolean(body.is_active),
  }
  assertWindow(fields.start_at, fields.end_at)
  assertOfferRules(fields)
  return fields
}

export function parsePatchOffer(body) {
  const patch = {}
  if (body.name !== undefined) patch.name = requireString(body, "name")
  if (body.type !== undefined) {
    const type = String(body.type)
    if (!OFFER_TYPE.includes(type)) throw new AppError("Invalid offer type", 400)
    patch.type = type
  }
  if (body.apply_to !== undefined) {
    const apply_to = String(body.apply_to)
    if (!OFFER_APPLY_TO.includes(apply_to)) {
      throw new AppError("apply_to must be product or category", 400)
    }
    patch.apply_to = apply_to
  }
  if (body.location_id !== undefined) patch.location_id = optionalUuid(body, "location_id")
  if (body.discount_type !== undefined) patch.discount_type = optionalDiscountType(body)
  if (body.discount_value !== undefined) {
    patch.discount_value = optionalNumber(body, "discount_value")
  }
  if (body.min_qty !== undefined) patch.min_qty = optionalNumber(body, "min_qty")
  if (body.buy_qty !== undefined) patch.buy_qty = optionalInt(body, "buy_qty")
  if (body.get_qty !== undefined) patch.get_qty = optionalInt(body, "get_qty")
  if (body.start_at !== undefined) patch.start_at = optionalDate(body, "start_at")
  if (body.end_at !== undefined) patch.end_at = optionalDate(body, "end_at")
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active)
  if (!Object.keys(patch).length) throw new AppError("No fields to update", 400)
  return patch
}

function parseTargetRow(row) {
  if (!row || typeof row !== "object") throw new AppError("Invalid target", 400)
  const product_id = optionalUuid(row, "product_id")
  const category_id = optionalUuid(row, "category_id")
  if (product_id && category_id) {
    throw new AppError("A target cannot have both product_id and category_id", 400)
  }
  if (!product_id && !category_id) {
    throw new AppError("Each target needs product_id or category_id", 400)
  }
  return {
    product_id,
    category_id,
    free_product_id: optionalUuid(row, "free_product_id"),
    promo_price: optionalNumber(row, "promo_price"),
  }
}

export function parseReplaceTargets(body) {
  const raw = Array.isArray(body) ? body : body.targets
  if (!Array.isArray(raw)) throw new AppError("targets must be an array", 400)
  return raw.map(parseTargetRow)
}
