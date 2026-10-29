import { AppError } from "../../shared/errors/AppError.js"
import {
  DISCOUNT_TYPE,
  OFFER_APPLY_TO,
  OFFER_TYPE,
  SUPPLIER_LOCATION_SCOPE,
} from "../../db/enums.js"
import { staffRefFrom } from "../../shared/utils/staff.util.js"

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

/**
 * Where the offer runs (store admin only; a manager's or cashier's offer is always for their own
 * location, see offer.service.js):
 * - location_scope "all"                          -> every location (location_ids ignored)
 * - location_scope "selected" + location_ids [..] -> one location or several
 * Sending only location_ids implies "selected"; an old single location_id is read the same way.
 */
function parseLocationScope(body) {
  const legacyId =
    body.location_ids === undefined && body.location_id !== undefined && body.location_id !== null
      ? body.location_id
      : undefined
  const rawIds = legacyId !== undefined && legacyId !== "" ? [legacyId] : body.location_ids
  const hasScope = body.location_scope !== undefined && body.location_scope !== null
  const hasIds = rawIds !== undefined && rawIds !== null
  if (!hasScope && !hasIds) return {}

  let ids = []
  if (hasIds) {
    if (!Array.isArray(rawIds)) {
      throw new AppError("location_ids must be an array of location ids", 400)
    }
    // Location numbers (1, 2, 3 — what the POS uses) or location UUIDs.
    ids = [...new Set(rawIds.map((value) => String(value).trim()))]
    for (const id of ids) {
      if (!/^[1-9]\d*$/.test(id) && !UUID_RE.test(id)) {
        throw new AppError("location_ids must contain location numbers (1, 2, 3...) or UUIDs", 400)
      }
    }
  }

  const scope = hasScope ? String(body.location_scope) : ids.length ? "selected" : "all"
  if (!SUPPLIER_LOCATION_SCOPE.includes(scope)) {
    throw new AppError("location_scope must be all or selected", 400)
  }
  if (scope === "selected" && !ids.length) {
    throw new AppError("location_ids is required when location_scope is selected", 400)
  }
  return { location_scope: scope, location_ids: scope === "selected" ? ids : [] }
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

  // The target sits in the same flat payload (category_id / product_id, promo_price,
  // free_product_id); a `targets` array is still accepted for several targets at once.
  const targets = Array.isArray(body.targets)
    ? body.targets.map(parseTargetRow)
    : [parseTargetRow(body)]
  for (const target of targets) {
    if (apply_to === "category" && !target.category_ref) {
      throw new AppError("category_id is required when apply_to is category", 400)
    }
    if (apply_to === "product" && !target.product_ref) {
      throw new AppError("product_id is required when apply_to is product", 400)
    }
  }

  const fields = {
    // Who added it (PIN-picked staff); defaults to the signed-in user.
    staff_ref: staffRefFrom(body),
    targets,
    name: requireString(body, "name"),
    type,
    apply_to,
    ...parseLocationScope(body),
    discount_type: optionalDiscountType(body),
    discount_value: optionalNumber(body, "discount_value"),
    min_qty: optionalNumber(body, "min_qty"),
    buy_qty: optionalInt(body, "buy_qty"),
    get_qty: optionalInt(body, "get_qty"),
    start_at: optionalDate(body, "start_at"),
    end_at: optionalDate(body, "end_at"),
    is_active: offerActive(body) ?? true,
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
  Object.assign(patch, parseLocationScope(body))
  if (body.discount_type !== undefined) patch.discount_type = optionalDiscountType(body)
  if (body.discount_value !== undefined) {
    patch.discount_value = optionalNumber(body, "discount_value")
  }
  if (body.min_qty !== undefined) patch.min_qty = optionalNumber(body, "min_qty")
  if (body.buy_qty !== undefined) patch.buy_qty = optionalInt(body, "buy_qty")
  if (body.get_qty !== undefined) patch.get_qty = optionalInt(body, "get_qty")
  if (body.start_at !== undefined) patch.start_at = optionalDate(body, "start_at")
  if (body.end_at !== undefined) patch.end_at = optionalDate(body, "end_at")
  const active = offerActive(body)
  if (active !== undefined) patch.is_active = active
  if (!Object.keys(patch).length) throw new AppError("No fields to update", 400)
  return patch
}

/** A product/category reference: its short number (e.g. 1) or its UUID, kept as a string. */
function optionalRef(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  const value = String(body[key]).trim()
  if ((/^\d+$/.test(value) && Number(value) > 0) || UUID_RE.test(value)) return value
  throw new AppError(`${key} must be a number or a UUID`, 400)
}

// Refs are resolved to UUIDs in offer.service (resolveTarget).
function parseTargetRow(row) {
  if (!row || typeof row !== "object") throw new AppError("Invalid target", 400)
  const product_ref = optionalRef(row, "product_id")
  const category_ref = optionalRef(row, "category_id")
  if (product_ref && category_ref) {
    throw new AppError("A target cannot have both product_id and category_id", 400)
  }
  if (!product_ref && !category_ref) {
    throw new AppError("Each target needs product_id or category_id", 400)
  }
  return {
    product_ref,
    category_ref,
    free_product_ref: optionalRef(row, "free_product_id"),
    promo_price: optionalNumber(row, "promo_price"),
  }
}

export function parseReplaceTargets(body) {
  const raw = Array.isArray(body) ? body : body.targets
  if (!Array.isArray(raw)) throw new AppError("targets must be an array", 400)
  return raw.map(parseTargetRow)
}

/**
 * Active / inactive: is_active (true / false) or status ("active" / "inactive"). An inactive
 * offer is never applied to any product or category. undefined = not sent.
 */
export function offerActive(body) {
  if (body.status !== undefined && body.status !== null && body.status !== "") {
    const status = String(body.status).toLowerCase()
    if (status !== "active" && status !== "inactive") throw new AppError("status must be active or inactive", 400)
    return status === "active"
  }
  if (body.is_active === undefined || body.is_active === null) return undefined
  if (body.is_active === "false" || body.is_active === 0 || body.is_active === "0") return false
  return Boolean(body.is_active)
}
