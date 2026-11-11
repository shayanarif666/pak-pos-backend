import { AppError } from "../../shared/errors/AppError.js"
import { parseCatalogVisibility } from "../../db/channelVisibility.js"
import { parseLocationScope } from "../../shared/utils/locationScope.util.js"
import { parseStockUnit } from "../../shared/utils/stockUnit.util.js"
import { DISCOUNT_APPLIES_TO, DISCOUNT_TYPE, PRODUCT_UNIT, TAX_AMOUNT_TYPE } from "../../db/enums.js"

/**
 * Product taxes, any number of them: taxes: [{ name, type: percentage | fixed, value }].
 * The single tax_name / tax_type / tax_value of older clients becomes a one-item list.
 * Returns undefined when nothing tax-related was sent (PATCH keeps the current taxes).
 */
const HEX_COLOR = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * colors: the colours it comes in, as hex codes ["#E11D48", "#2563EB"] ("e11d48" / "#abc" are
 * accepted and saved as "#E11D48" / "#AABBCC"; repeats are dropped). null / "" = none.
 * undefined = not sent. A multipart form may send it as a JSON string.
 */
export function parseColors(body, label = "colors") {
  if (body?.colors === undefined) return undefined
  let raw = body.colors
  if (raw === null || raw === "") return []
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw)
    } catch {
      raw = raw.split(",")
    }
  }
  if (!Array.isArray(raw)) throw new AppError(`${label} must be an array of hex colour codes`, 400)
  if (raw.length > 50) throw new AppError(`${label}: 50 colours at most`, 400)
  const out = []
  for (const [index, value] of raw.entries()) {
    const text = String(value ?? "").trim()
    const match = HEX_COLOR.exec(text)
    if (!match) throw new AppError(`${label}[${index}] must be a hex colour code like #E11D48`, 400)
    let hex = match[1].toUpperCase()
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("")
    if (!out.includes(`#${hex}`)) out.push(`#${hex}`)
  }
  return out
}

function parseTaxes(body) {
  let list
  if (body.taxes !== undefined) {
    if (body.taxes === null || body.taxes === "") return []
    let raw = body.taxes
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw)
      } catch {
        throw new AppError("taxes must be an array", 400)
      }
    }
    if (!Array.isArray(raw)) throw new AppError("taxes must be an array", 400)
    list = raw
  } else if (body.tax_type !== undefined || body.tax_value !== undefined) {
    list =
      body.tax_type && body.tax_value !== null && body.tax_value !== ""
        ? [{ name: body.tax_name, type: body.tax_type, value: body.tax_value }]
        : []
  } else {
    return undefined
  }
  return list.map((tax, index) => {
    if (!tax || typeof tax !== "object") throw new AppError(`taxes[${index}] is invalid`, 400)
    const type = String(tax.type || "")
    if (!TAX_AMOUNT_TYPE.includes(type)) {
      throw new AppError(`taxes[${index}].type must be percentage or fixed`, 400)
    }
    const value = Number(tax.value)
    if (tax.value === undefined || tax.value === null || tax.value === "" || Number.isNaN(value) || value < 0) {
      throw new AppError(`taxes[${index}].value must be a number >= 0`, 400)
    }
    if (type === "percentage" && value > 100) {
      throw new AppError(`taxes[${index}].value cannot exceed 100`, 400)
    }
    const name = tax.name === undefined || tax.name === null ? "" : String(tax.name).trim()
    return { name: name || "Tax", type, value }
  })
}

function requireString(body, key) {
  const value = body[key]
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError(`${key} is required`, 400)
  }
  return value.trim()
}

// Required value sent as either a string or a number (e.g. category_id: 1 for a category_number,
// or a UUID string; a barcode typed as digits). Returned as a trimmed string.
function requireStringOrNumber(body, key) {
  if (body[key] == null || body[key] === "") {
    throw new AppError(`${key} is required`, 400)
  }
  return String(body[key]).trim()
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
  const value = body[key]
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  if (typeof value === "string") {
    const s = value.trim().toLowerCase()
    if (["true", "1", "yes", "on"].includes(s)) return true
    if (["false", "0", "no", "off", ""].includes(s)) return false
  }
  return Boolean(value)
}

function requireNumber(body, key, { min = 0, label = key } = {}) {
  if (body[key] === undefined || body[key] === null || body[key] === "") {
    throw new AppError(`${label} is required`, 400)
  }
  const n = Number(body[key])
  if (Number.isNaN(n) || n < min) {
    throw new AppError(`${label} must be a number >= ${min}`, 400)
  }
  return n
}

// Price fields as the API docs name them, mapped onto the column names. A loose item sends
// cost/price; a pack product sends pack_cost/pack_price only (its per-unit prices are always
// calculated in product.service). The column names themselves are still accepted.
const PRICE_ALIASES = {
  cost_price: ["cost"],
  selling_price: ["price"],
  pack_cost_price: ["pack_cost"],
  pack_selling_price: ["pack_price"],
}

/**
 * The product discount may come as one object, discount: { name, type, value, applies_to? }, or as the
 * flat discount_name / discount_type / discount_value / discount_applies_to. The object wins; the type
 * is read in any case ("Percentage" = percentage).
 */
function withDiscountObject(body) {
  const out = { ...body }
  const object = body.discount
  if (object && typeof object === "object" && !Array.isArray(object)) {
    if (object.name !== undefined) out.discount_name = object.name
    if (object.type !== undefined) out.discount_type = object.type
    if (object.value !== undefined) out.discount_value = object.value
    if (object.applies_to !== undefined) out.discount_applies_to = object.applies_to
  }
  if (typeof out.discount_type === "string") out.discount_type = out.discount_type.trim().toLowerCase() || null
  return out
}

function withPriceAliases(rawBody) {
  const body = withDiscountObject(rawBody)
  const out = { ...body }
  for (const [column, aliases] of Object.entries(PRICE_ALIASES)) {
    if (out[column] !== undefined) continue
    const alias = aliases.find((key) => body[key] !== undefined)
    if (alias) out[column] = body[alias]
  }
  return out
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

function normalizeImages(raw) {
  if (raw === undefined) return undefined
  if (raw === null || raw === "") return []
  let list = raw
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw)
    } catch {
      list = raw.split(",").map((item) => item.trim()).filter(Boolean)
    }
  }
  if (!Array.isArray(list)) {
    throw new AppError("images must be an array", 400)
  }
  return list
    .map((item) => {
      if (typeof item === "string" && item.trim()) return { url: item.trim() }
      if (item && typeof item === "object" && item.url) {
        return { url: String(item.url).trim() }
      }
      return null
    })
    .filter((item) => item?.url)
}

// `image` is the simple single-URL input; `image_url` is still read as a legacy alias (the
// column itself is gone). An empty string means "no image", not an error.
function resolveProductImages(body, { allowMissingImages = false } = {}) {
  let images = normalizeImages(body.images)
  const aliasKey =
    body.image !== undefined ? "image" : body.image_url !== undefined ? "image_url" : null
  let featured_image =
    body.featured_image !== undefined
      ? optionalString(body, "featured_image")
      : aliasKey
        ? optionalString(body, aliasKey)
        : undefined

  if (images === undefined && featured_image === undefined) return {}

  if (images === undefined) {
    if (allowMissingImages) return { featured_image: featured_image ?? null }
    images = []
  }
  if (!featured_image) featured_image = images[0]?.url || null
  if (featured_image && !images.some((item) => item.url === featured_image)) {
    images = [{ url: featured_image }, ...images]
  }
  if (images.length === 1) featured_image = images[0].url

  return { images, featured_image }
}

const REF_RE = /^([1-9][0-9]*|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i

/**
 * Stock per location: stock: [{ location_id, qty, stock_unit?, expiry_date? }] (location number or
 * UUID), or one number (older clients) for the request's location. stock_unit: unit (loose items,
 * default) or pack (qty is whole packs of a pack product). Returns [{ location, qty, stock_unit, expiry_date }]
 * (location null = the request's location), or undefined when nothing was sent. A location sent
 * twice keeps its last row.
 */
function parseStockRows(row, label) {
  const raw = row.stock ?? row.opening_stock
  const fallbackLocation = row.location_id ?? row.locationId ?? null
  if (raw === undefined || raw === null || raw === "") return undefined
  if (typeof raw === "number" || (typeof raw === "string" && /^\s*\d+(\.\d+)?\s*$/.test(raw))) {
    return [{
      location: fallbackLocation == null ? null : String(fallbackLocation).trim(),
      qty: Number(raw),
      stock_unit: parseStockUnit(row.stock_unit, `${label}_unit`),
    }]
  }
  let list = raw
  if (typeof list === "string") {
    try {
      list = JSON.parse(list)
    } catch {
      throw new AppError(`${label} must be an array of { location_id, qty }`, 400)
    }
  }
  if (!Array.isArray(list)) throw new AppError(`${label} must be an array of { location_id, qty }`, 400)
  const byLocation = new Map()
  list.forEach((entry, index) => {
    const at = `${label}[${index}]`
    if (!entry || typeof entry !== "object") throw new AppError(`${at} is invalid`, 400)
    const location = entry.location_id ?? entry.locationId
    if (location == null || location === "") throw new AppError(`${at}.location_id is required`, 400)
    if (!REF_RE.test(String(location).trim())) throw new AppError(`${at}.location_id must be a location number or UUID`, 400)
    const qty = Number(entry.qty)
    if (entry.qty == null || entry.qty === "" || Number.isNaN(qty) || qty < 0) {
      throw new AppError(`${at}.qty must be a number >= 0`, 400)
    }
    let expiry_date
    if (entry.expiry_date != null && entry.expiry_date !== "") {
      if (Number.isNaN(new Date(entry.expiry_date).getTime())) throw new AppError(`${at}.expiry_date is invalid`, 400)
      expiry_date = String(entry.expiry_date).slice(0, 10)
    }
    const stock_unit = parseStockUnit(entry.stock_unit, `${at}.stock_unit`)
    byLocation.set(String(location).trim(), { location: String(location).trim(), qty, stock_unit, expiry_date })
  })
  return [...byLocation.values()]
}

/** stock_scope: all (every location the product is sold at) or selected + stock_location_ids. */
function parseStockScope(body) {
  if ((body.stock_scope == null || body.stock_scope === "") && body.stock_location_ids == null) return {}
  const scope = parseLocationScope({ location_scope: body.stock_scope ?? undefined, location_ids: body.stock_location_ids })
  return { stock_scope: scope.location_scope, stock_location_ids: scope.location_ids }
}

/**
 * A variant's own discount: discount { name, type (percentage | fixed, any case), value, applies_to? } (or
 * the flat discount_name / discount_type / discount_value / discount_applies_to); discount null removes it
 * (PATCH). uses_product_discount: true (default) = without its own discount it takes its product's; false = none.
 */
function parseVariantDiscount(row, label) {
  const flat = withDiscountObject(row)
  const uses = optionalBool(row, "uses_product_discount")
  if (row.discount === null) return { discount: null, uses_product_discount: uses }
  const sent = flat.discount_type !== undefined || flat.discount_value !== undefined || flat.discount_name !== undefined || (row.discount && typeof row.discount === "object")
  if (!sent) return { discount: undefined, uses_product_discount: uses }
  const type = flat.discount_type
  if (!type || !DISCOUNT_TYPE.includes(type)) throw new AppError(`${label}.discount.type must be percentage or fixed`, 400)
  const value = flat.discount_value === undefined || flat.discount_value === null || flat.discount_value === "" ? NaN : Number(flat.discount_value)
  if (Number.isNaN(value) || value <= 0) throw new AppError(`${label}.discount.value must be a number greater than 0`, 400)
  if (type === "percentage" && value > 100) throw new AppError(`${label}.discount.value cannot be more than 100 for a percentage`, 400)
  return {
    discount: { name: optionalString(flat, "discount_name") ?? null, type, value, applies_to: parseAppliesTo(flat) ?? "all" },
    uses_product_discount: uses,
  }
}

/**
 * variants: [{ name, sku?, barcode, cost, price, stock?, location_id?, id? }] — each one becomes a
 * product of its own (same category, taxes, unit… as the parent). id (PATCH only) = an existing
 * variant's product number or UUID, to change it instead of adding one.
 */
function parseVariants(body, { patch = false } = {}) {
  if (body.variants === undefined || body.variants === null) return undefined
  if (!Array.isArray(body.variants)) throw new AppError("variants must be an array", 400)
  const seen = new Set()
  return body.variants.map((raw, index) => {
    const label = `variants[${index}]`
    if (!raw || typeof raw !== "object") throw new AppError(`${label} is invalid`, 400)
    const row = withPriceAliases(raw)
    const ref = row.id ?? row.product_id
    const existing = patch && ref != null && ref !== ""
    if (existing && !REF_RE.test(String(ref).trim())) throw new AppError(`${label}.id must be the variant number (1, 2, 3…) or its UUID`, 400)
    const name = existing ? optionalString(row, "name") : requireString(row, "name")
    const barcode = existing
      ? row.barcode === undefined ? undefined : optionalString({ barcode: row.barcode == null ? null : String(row.barcode) }, "barcode")
      : requireStringOrNumber(row, "barcode")
    const sku = row.sku == null || row.sku === "" ? undefined : String(row.sku).trim()
    if (sku) {
      if (seen.has(`s:${sku}`)) throw new AppError(`${label}.sku is used twice in this product`, 400)
      seen.add(`s:${sku}`)
    }
    // A pack variant: its own pack size / pack cost / pack price (unit prices = pack ÷ size).
    const isPack = optionalBool(row, "is_pack_product") ?? (row.pack_size != null && row.pack_size !== "" ? true : undefined)
    const packSize = optionalInt(row, "pack_size", { min: 2 })
    if (isPack && !existing) {
      if (!packSize) throw new AppError(`${label}.pack_size must be 2 or more for a pack variant`, 400)
      if (!(optionalNumber(row, "pack_cost_price") > 0)) throw new AppError(`${label}.pack_cost is required for a pack variant`, 400)
      if (!(optionalNumber(row, "pack_selling_price") > 0)) throw new AppError(`${label}.pack_price is required for a pack variant`, 400)
    }
    const sellLoose = optionalBool(row, "sell_loose")
    const { discount, uses_product_discount } = parseVariantDiscount(row, label)
    // A pack variant that is also sold loose has its own unit cost / price too.
    const looseRequired = !existing && (!isPack || sellLoose === true)
    // Its one image: a URL (image or featured_image); null / "" removes it on PATCH.
    const rawImage = row.image !== undefined ? row.image : row.featured_image
    if (rawImage != null && typeof rawImage !== "string") throw new AppError(`${label}.image must be an image URL`, 400)
    const image = rawImage === undefined ? undefined : rawImage && rawImage.trim() ? rawImage.trim() : null
    return {
      ref: existing ? String(ref).trim() : null,
      name,
      sku,
      barcode,
      cost_price: looseRequired ? requireNumber(row, "cost_price", { label: `${label}.cost` }) : optionalNumber(row, "cost_price"),
      selling_price: looseRequired ? requireNumber(row, "selling_price", { label: `${label}.price` }) : optionalNumber(row, "selling_price"),
      is_pack_product: isPack,
      pack_size: packSize,
      pack_cost_price: optionalNumber(row, "pack_cost_price"),
      pack_selling_price: optionalNumber(row, "pack_selling_price"),
      sell_loose: optionalBool(row, "sell_loose"),
      // Its own discount { name, type, value, applies_to }; null (PATCH) removes it; undefined = not sent.
      discount,
      // false = no discount at all (it does not take its product's). Default true.
      uses_product_discount,
      // What the low stock level counts on a pack + loose variant: pack | unit. undefined = as its product.
      low_stock_unit: parseLowStockUnit(row, `${label}.low_stock_unit`),
      // Its own low stock level (in low_stock_unit). undefined = as its product.
      low_stock_threshold: row.low_stock_threshold === undefined || row.low_stock_threshold === null || row.low_stock_threshold === "" ? undefined : requireNumber(row, "low_stock_threshold", { label: `${label}.low_stock_threshold` }),
      // Sold by weight (kg) on the scale. Left out = as its product.
      is_weight_based: optionalBool(row, "is_weight_based"),
      // This variant's own taxes, added to the product's taxes. undefined = not sent.
      taxes: parseTaxes(row),
      // Opening stock (create / a new variant) or the counted stock (an existing variant), per location.
      stock: parseStockRows(row.stock === undefined && row.qty !== undefined ? { ...row, stock: row.qty } : row, `${label}.stock`),
      image,
      // The colours this variant comes in (hex codes). undefined = not sent.
      colors: parseColors(row, `${label}.colors`),
      is_active: optionalBool(row, "is_active"),
    }
  })
}

/** pack | unit (what the low stock level counts on a pack + loose product); undefined when not sent. */
function parseLowStockUnit(body, label = "low_stock_unit") {
  const raw = body[label.split(".").pop()]
  if (raw === undefined || raw === null || raw === "") return undefined
  const value = String(raw).trim().toLowerCase()
  if (value !== "pack" && value !== "unit") throw new AppError(`${label} must be pack or unit`, 400)
  return value
}

/** all | pack | loose | weight (what the product discount is taken off); undefined when not sent. */
function parseAppliesTo(body) {
  if (body.discount_applies_to === undefined || body.discount_applies_to === null || body.discount_applies_to === "") return undefined
  const value = String(body.discount_applies_to)
  if (!DISCOUNT_APPLIES_TO.includes(value)) {
    throw new AppError(`discount_applies_to must be one of: ${DISCOUNT_APPLIES_TO.join(", ")}`, 400)
  }
  return value
}

export function parseCreateProduct(rawBody) {
  const body = withPriceAliases(rawBody)
  const unit = body.unit === undefined ? "piece" : String(body.unit)
  if (!PRODUCT_UNIT.includes(unit)) {
    throw new AppError(`unit must be one of: ${PRODUCT_UNIT.join(", ")}`, 400)
  }

  const imageFields = resolveProductImages(body)
  const isPack = optionalBool(body, "is_pack_product") ?? false
  // A pack that is also sold loose has its own unit cost / price (the pack price is not unit price x size).
  const sellLoose = optionalBool(body, "sell_loose") ?? false
  const variants = parseVariants(body)
  // With variants, each variant carries its own barcode and prices; the parent's are optional.
  const hasVariants = Boolean(variants?.length)

  const fields = {
    title: requireString(body, "title"),
    // Left out = made from the title.
    sku: body.sku == null || body.sku === "" ? undefined : String(body.sku).trim(),
    barcode: hasVariants ? optionalString({ barcode: body.barcode == null ? null : String(body.barcode) }, "barcode") ?? null : requireStringOrNumber(body, "barcode"),
    ...(hasVariants ? { variants } : {}),
    // Where a variant's opening stock goes when it does not name a location.
    stock_location_id: body.stock_location_id ?? body.location_id ?? null,
    images: imageFields.images ?? [],
    featured_image: imageFields.featured_image ?? null,
    description: optionalString(body, "description") ?? null,
    category_id: requireStringOrNumber(body, "category_id"),
    unit,
    // A pack-only product may leave the per-unit prices out: createProduct() derives them from the
    // pack price ÷ pack_size. A pack that is also sold loose sends both (pack and unit).
    cost_price: (isPack && !sellLoose) || hasVariants
      ? optionalNumber(body, "cost_price") ?? null
      : requireNumber(body, "cost_price", { label: "cost" }),
    selling_price: (isPack && !sellLoose) || hasVariants
      ? optionalNumber(body, "selling_price") ?? null
      : requireNumber(body, "selling_price", { label: "price" }),
    // Left undefined when not sent: createProduct() then derives it from discount_type/value.
    has_product_discount: optionalBool(body, "has_product_discount"),
    discount_type: body.discount_type || null,
    discount_value: optionalNumber(body, "discount_value") ?? null,
    discount_name: optionalString(body, "discount_name") ?? null,
    discount_applies_to: parseAppliesTo(body) ?? "all",
    taxes: parseTaxes(body) ?? [],
    is_pack_product: isPack,
    pack_size: optionalInt(body, "pack_size", { min: 2 }) ?? null,
    // Whole-pack cost/price — independent of cost_price/selling_price × pack_size, since bulk
    // purchase/sale economics differ from per-unit. Required when is_pack_product (enforced in
    // assertPackRules, same as pack_size).
    pack_cost_price: optionalNumber(body, "pack_cost_price") ?? null,
    pack_selling_price: optionalNumber(body, "pack_selling_price") ?? null,
    sell_loose: sellLoose,
    is_weight_based: optionalBool(body, "is_weight_based") ?? false,
    // The colours it comes in (hex codes); with variants each variant has its own.
    colors: parseColors(body) ?? [],
    has_bulk_discount: optionalBool(body, "has_bulk_discount") ?? false,
    // 0 with variants (each variant has its own), else 1.
    low_stock_threshold: optionalNumber(body, "low_stock_threshold") ?? 1,
    low_stock_unit: parseLowStockUnit(body) ?? "unit",
    is_published: optionalBool(body, "is_published") ?? false,
    ...parseCatalogVisibility(body),
    // Where the product is sold: all locations (default) or selected ones.
    ...parseLocationScope(body),
    // Which of those hold its stock, and the opening stock per location (no variants).
    ...parseStockScope(body),
    ...(hasVariants ? {} : { stock: parseStockRows(body, "stock") }),
    // optionalBool: a multipart form sends "false" as text.
    is_active: optionalBool(body, "is_active") ?? true,
  }

  if (fields.discount_type && !DISCOUNT_TYPE.includes(fields.discount_type)) {
    throw new AppError("discount_type must be percentage or fixed", 400)
  }
  return fields
}

export function parsePatchProduct(rawBody) {
  const body = withPriceAliases(rawBody)
  const fields = {}
  if (body.title !== undefined) fields.title = requireString(body, "title")
  if (body.sku !== undefined) fields.sku = requireString(body, "sku")
  if (body.barcode !== undefined) fields.barcode = optionalString(body, "barcode")
  if (
    body.image !== undefined ||
    body.image_url !== undefined ||
    body.images !== undefined ||
    body.featured_image !== undefined
  ) {
    Object.assign(fields, resolveProductImages(body, { allowMissingImages: true }))
  }
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
  if (body.discount_name !== undefined) {
    fields.discount_name = optionalString(body, "discount_name")
  }
  if (body.discount_applies_to !== undefined) fields.discount_applies_to = parseAppliesTo(body) ?? "all"
  const taxes = parseTaxes(body)
  if (taxes !== undefined) fields.taxes = taxes
  if (body.is_pack_product !== undefined) {
    fields.is_pack_product = optionalBool(body, "is_pack_product")
  }
  if (body.pack_size !== undefined) {
    fields.pack_size = optionalInt(body, "pack_size", { min: 2 })
  }
  if (body.pack_cost_price !== undefined) {
    fields.pack_cost_price = optionalNumber(body, "pack_cost_price")
  }
  if (body.pack_selling_price !== undefined) {
    fields.pack_selling_price = optionalNumber(body, "pack_selling_price")
  }
  if (body.sell_loose !== undefined) fields.sell_loose = optionalBool(body, "sell_loose")
  if (body.is_weight_based !== undefined) {
    fields.is_weight_based = optionalBool(body, "is_weight_based")
  }
  if (body.has_bulk_discount !== undefined) {
    fields.has_bulk_discount = optionalBool(body, "has_bulk_discount")
  }
  if (body.colors !== undefined) fields.colors = parseColors(body)
  if (body.low_stock_threshold !== undefined) {
    fields.low_stock_threshold = optionalNumber(body, "low_stock_threshold")
  }
  if (body.low_stock_unit !== undefined) fields.low_stock_unit = parseLowStockUnit(body) ?? "unit"
  if (body.is_published !== undefined) {
    fields.is_published = optionalBool(body, "is_published")
  }
  Object.assign(fields, parseCatalogVisibility(body, { patch: true }))
  Object.assign(fields, parseLocationScope(body))
  Object.assign(fields, parseStockScope(body))
  // The counted stock per location: the server writes the difference as an adjustment.
  const stock = parseStockRows(body, "stock")
  if (stock !== undefined) {
    fields.stock = stock
    fields.stock_location_id = body.stock_location_id ?? body.location_id ?? null
  }
  if (body.is_active !== undefined) fields.is_active = optionalBool(body, "is_active")
  const variants = parseVariants(body, { patch: true })
  if (variants) {
    fields.variants = variants
    fields.stock_location_id = body.stock_location_id ?? body.location_id ?? null
  }
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
