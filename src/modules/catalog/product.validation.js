import { AppError } from "../../shared/errors/AppError.js"
import { DISCOUNT_TYPE, PRODUCT_UNIT, TAX_AMOUNT_TYPE } from "../../db/enums.js"

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
  if (body[key] === undefined) return undefined
  if (body[key] === null || body[key] === "") return null
  const n = Number(body[key])
  if (Number.isNaN(n) || n < min) {
    throw new AppError(`${key} must be a number >= ${min}`, 400)
  }
  return n
}

function optionalInt(body, key, { min = 0 } = {}) {
  if (body[key] === undefined) return undefined
  if (body[key] === null || body[key] === "") return null
  const n = Number(body[key])
  if (!Number.isInteger(n) || n < min) {
    throw new AppError(`${key} must be an integer >= ${min}`, 400)
  }
  return n
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function requireUuid(body, key) {
  const value = body[key]
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new AppError(`${key} is required and must be a UUID`, 400)
  }
  return value
}

export function parseCreateProduct(body) {
  const unit = body.unit === undefined ? "piece" : String(body.unit)
  if (!PRODUCT_UNIT.includes(unit)) {
    throw new AppError(`unit must be one of: ${PRODUCT_UNIT.join(", ")}`, 400)
  }

  const fields = {
    title: requireString(body, "title"),
    slug: optionalString(body, "slug"),
    sku: requireString(body, "sku"),
    barcode: optionalString(body, "barcode") ?? null,
    image_url: optionalString(body, "image_url") ?? null,
    description: optionalString(body, "description") ?? null,
    category_id: requireUuid(body, "category_id"),
    unit,
    cost_price: requireNumber(body, "cost_price"),
    selling_price: requireNumber(body, "selling_price"),
    has_product_discount: optionalBool(body, "has_product_discount") ?? false,
    discount_type: body.discount_type || null,
    discount_value: optionalNumber(body, "discount_value") ?? null,
    tax_type: body.tax_type || null,
    tax_value: optionalNumber(body, "tax_value") ?? null,
    is_pack_product: optionalBool(body, "is_pack_product") ?? false,
    pack_size: optionalInt(body, "pack_size", { min: 2 }) ?? null,
    sell_loose: optionalBool(body, "sell_loose") ?? false,
    is_weight_based: optionalBool(body, "is_weight_based") ?? false,
    has_bulk_discount: optionalBool(body, "has_bulk_discount") ?? false,
    expiry_date: optionalString(body, "expiry_date"),
    low_stock_threshold: optionalNumber(body, "low_stock_threshold") ?? 10,
    is_published: optionalBool(body, "is_published") ?? false,
    pos_visible: body.pos_visible === undefined ? true : Boolean(body.pos_visible),
    web_visible: body.web_visible === undefined ? true : Boolean(body.web_visible),
    is_active: body.is_active === undefined ? true : Boolean(body.is_active),
  }

  if (fields.discount_type && !DISCOUNT_TYPE.includes(fields.discount_type)) {
    throw new AppError("discount_type must be percentage or fixed", 400)
  }
  if (fields.tax_type && !TAX_AMOUNT_TYPE.includes(fields.tax_type)) {
    throw new AppError("tax_type must be percentage or fixed", 400)
  }
  return fields
}

export function parsePatchProduct(body) {
  const fields = {}
  if (body.title !== undefined) fields.title = requireString(body, "title")
  if (body.slug !== undefined) fields.slug = optionalString(body, "slug")
  if (body.sku !== undefined) fields.sku = requireString(body, "sku")
  if (body.barcode !== undefined) fields.barcode = optionalString(body, "barcode")
  if (body.image_url !== undefined) fields.image_url = optionalString(body, "image_url")
  if (body.description !== undefined) {
    fields.description = optionalString(body, "description")
  }
  if (body.category_id !== undefined) {
    fields.category_id = requireUuid(body, "category_id")
  }
  if (body.unit !== undefined) {
    if (!PRODUCT_UNIT.includes(body.unit)) {
      throw new AppError(`unit must be one of: ${PRODUCT_UNIT.join(", ")}`, 400)
    }
    fields.unit = body.unit
  }
  if (body.cost_price !== undefined) fields.cost_price = requireNumber(body, "cost_price")
  if (body.selling_price !== undefined) {
    fields.selling_price = requireNumber(body, "selling_price")
  }
  if (body.has_product_discount !== undefined) {
    fields.has_product_discount = optionalBool(body, "has_product_discount")
  }
  if (body.discount_type !== undefined) {
    if (body.discount_type !== null && !DISCOUNT_TYPE.includes(body.discount_type)) {
      throw new AppError("discount_type must be percentage or fixed", 400)
    }
    fields.discount_type = body.discount_type
  }
  if (body.discount_value !== undefined) {
    fields.discount_value = optionalNumber(body, "discount_value")
  }
  if (body.tax_type !== undefined) {
    if (body.tax_type !== null && !TAX_AMOUNT_TYPE.includes(body.tax_type)) {
      throw new AppError("tax_type must be percentage or fixed", 400)
    }
    fields.tax_type = body.tax_type
  }
  if (body.tax_value !== undefined) fields.tax_value = optionalNumber(body, "tax_value")
  if (body.is_pack_product !== undefined) {
    fields.is_pack_product = optionalBool(body, "is_pack_product")
  }
  if (body.pack_size !== undefined) {
    fields.pack_size = optionalInt(body, "pack_size", { min: 2 })
  }
  if (body.sell_loose !== undefined) fields.sell_loose = optionalBool(body, "sell_loose")
  if (body.is_weight_based !== undefined) {
    fields.is_weight_based = optionalBool(body, "is_weight_based")
  }
  if (body.has_bulk_discount !== undefined) {
    fields.has_bulk_discount = optionalBool(body, "has_bulk_discount")
  }
  if (body.expiry_date !== undefined) fields.expiry_date = optionalString(body, "expiry_date")
  if (body.low_stock_threshold !== undefined) {
    fields.low_stock_threshold = optionalNumber(body, "low_stock_threshold")
  }
  if (body.is_published !== undefined) {
    fields.is_published = optionalBool(body, "is_published")
  }
  if (body.pos_visible !== undefined) fields.pos_visible = optionalBool(body, "pos_visible")
  if (body.web_visible !== undefined) fields.web_visible = optionalBool(body, "web_visible")
  if (body.is_active !== undefined) fields.is_active = optionalBool(body, "is_active")
  return fields
}

export function parseWeightPatch(body) {
  if (body.is_weight_based === undefined) {
    throw new AppError("is_weight_based is required", 400)
  }
  return { is_weight_based: Boolean(body.is_weight_based) }
}

export function parseBulkTiers(body) {
  if (!Array.isArray(body.tiers)) {
    throw new AppError("tiers must be an array", 400)
  }
  const seen = new Set()
  const tiers = body.tiers.map((row, index) => {
    const min_qty = Number(row?.min_qty)
    if (Number.isNaN(min_qty) || min_qty <= 0) {
      throw new AppError(`tiers[${index}].min_qty must be > 0`, 400)
    }
    if (seen.has(min_qty)) {
      throw new AppError(`Duplicate min_qty ${min_qty}`, 400)
    }
    seen.add(min_qty)
    if (!DISCOUNT_TYPE.includes(row.discount_type)) {
      throw new AppError(`tiers[${index}].discount_type must be percentage or fixed`, 400)
    }
    const discount_value = Number(row.discount_value)
    if (Number.isNaN(discount_value) || discount_value < 0) {
      throw new AppError(`tiers[${index}].discount_value must be >= 0`, 400)
    }
    return { min_qty, discount_type: row.discount_type, discount_value }
  })
  return { tiers }
}
