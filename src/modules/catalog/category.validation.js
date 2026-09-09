import { AppError } from "../../shared/errors/AppError.js"
import { DISCOUNT_TYPE, TAX_AMOUNT_TYPE } from "../../db/enums.js"

function requireString(body, key) {
  const value = body[key]
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError(`${key} is required`, 400)
  }
  return value.trim()
}

function optionalString(body, key, { max = 20000 } = {}) {
  if (body[key] === undefined) return undefined
  if (body[key] === null || body[key] === "") return null
  if (typeof body[key] !== "string") {
    throw new AppError(`${key} must be a string`, 400)
  }
  const trimmed = body[key].trim()
  if (trimmed.length > max) throw new AppError(`${key} is too long`, 400)
  return trimmed || null
}

function optionalBool(body, key) {
  if (body[key] === undefined) return undefined
  return Boolean(body[key])
}

function optionalInt(body, key) {
  if (body[key] === undefined) return undefined
  if (body[key] === null) return null
  const n = Number(body[key])
  if (!Number.isInteger(n)) throw new AppError(`${key} must be an integer`, 400)
  return n
}

function optionalNumber(body, key) {
  if (body[key] === undefined) return undefined
  if (body[key] === null || body[key] === "") return null
  const n = Number(body[key])
  if (Number.isNaN(n) || n < 0) {
    throw new AppError(`${key} must be a number >= 0`, 400)
  }
  return n
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function optionalUuid(body, key) {
  if (body[key] === undefined) return undefined
  if (body[key] === null || body[key] === "") return null
  if (typeof body[key] !== "string" || !UUID_RE.test(body[key])) {
    throw new AppError(`${key} must be a UUID`, 400)
  }
  return body[key]
}

function optionalEnum(body, key, allowed, label) {
  if (body[key] === undefined) return undefined
  if (body[key] === null || body[key] === "") return null
  if (!allowed.includes(body[key])) {
    throw new AppError(`${key} must be ${label}`, 400)
  }
  return body[key]
}

function optionalTaxType(body, key) {
  return optionalEnum(body, key, TAX_AMOUNT_TYPE, "percentage or fixed")
}

function optionalDiscountType(body, key) {
  return optionalEnum(body, key, DISCOUNT_TYPE, "percentage or fixed")
}

function assertPair(type, value, label) {
  if (type && (value == null || value === "")) {
    throw new AppError(`${label}_value is required when ${label}_type is set`, 400)
  }
  if (!type && value != null) {
    throw new AppError(`${label}_type is required when ${label}_value is set`, 400)
  }
  if (type === "percentage" && Number(value) > 100) {
    throw new AppError(`${label}_value cannot exceed 100 for percentage`, 400)
  }
}

export function parseCreateCategory(body) {
  const fields = {
    name: requireString(body, "name"),
    slug: optionalString(body, "slug"),
    parent_category_id: optionalUuid(body, "parent_category_id") ?? null,
    image_url: optionalString(body, "image_url") ?? null,
    description: optionalString(body, "description") ?? null,
    tax_type: optionalTaxType(body, "tax_type") ?? null,
    tax_value: optionalNumber(body, "tax_value") ?? null,
    discount_type: optionalDiscountType(body, "discount_type") ?? null,
    discount_value: optionalNumber(body, "discount_value") ?? null,
    is_active: body.is_active === undefined ? true : Boolean(body.is_active),
    sort_order:
      body.sort_order === undefined || body.sort_order === null
        ? 0
        : optionalInt(body, "sort_order"),
    pos_visible: body.pos_visible === undefined ? true : Boolean(body.pos_visible),
    web_visible: body.web_visible === undefined ? true : Boolean(body.web_visible),
  }
  assertPair(fields.tax_type, fields.tax_value, "tax")
  assertPair(fields.discount_type, fields.discount_value, "discount")
  return fields
}

export function parsePatchCategory(body) {
  const fields = {}
  if (body.name !== undefined) fields.name = requireString(body, "name")
  if (body.slug !== undefined) fields.slug = optionalString(body, "slug")
  if (body.parent_category_id !== undefined) {
    fields.parent_category_id = optionalUuid(body, "parent_category_id")
  }
  if (body.image_url !== undefined) fields.image_url = optionalString(body, "image_url")
  if (body.description !== undefined) {
    fields.description = optionalString(body, "description")
  }
  if (body.tax_type !== undefined) fields.tax_type = optionalTaxType(body, "tax_type")
  if (body.tax_value !== undefined) fields.tax_value = optionalNumber(body, "tax_value")
  if (body.discount_type !== undefined) {
    fields.discount_type = optionalDiscountType(body, "discount_type")
  }
  if (body.discount_value !== undefined) {
    fields.discount_value = optionalNumber(body, "discount_value")
  }
  if (body.tax_type !== undefined || body.tax_value !== undefined) {
    assertPair(
      fields.tax_type !== undefined ? fields.tax_type : body.tax_type,
      fields.tax_value !== undefined ? fields.tax_value : body.tax_value,
      "tax"
    )
  }
  if (body.discount_type !== undefined || body.discount_value !== undefined) {
    assertPair(
      fields.discount_type !== undefined ? fields.discount_type : body.discount_type,
      fields.discount_value !== undefined ? fields.discount_value : body.discount_value,
      "discount"
    )
  }
  if (body.is_active !== undefined) fields.is_active = optionalBool(body, "is_active")
  if (body.sort_order !== undefined) fields.sort_order = optionalInt(body, "sort_order")
  if (body.pos_visible !== undefined) {
    fields.pos_visible = optionalBool(body, "pos_visible")
  }
  if (body.web_visible !== undefined) {
    fields.web_visible = optionalBool(body, "web_visible")
  }
  return fields
}
