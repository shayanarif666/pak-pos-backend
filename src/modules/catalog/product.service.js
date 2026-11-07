import { Op, UniqueConstraintError } from "sequelize"
import { lotsByStock, publicLot } from "./stockLots.service.js"
import { StockLot } from "./stockLot.model.js"
import { sequelize } from "../../db/sequelize.js"
import { Product } from "./product.model.js"
import { Category } from "./category.model.js"
import { ProductStock } from "./productStock.model.js"
import { ProductBulkTier } from "./productBulkTier.model.js"
import { ensureUniqueSlug, slugify } from "../../shared/utils/slugify.js"
import { nextProductNumber } from "../../shared/utils/counter.util.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import { copyVisibility, publicVisibility } from "../../db/channelVisibility.js"
import { Location } from "../locations/location.model.js"
import {
  lineTaxBreakdown,
  money,
  pricingStore,
  productTaxList,
  taxOn,
  unitDiscountParts,
} from "../commerce/pricing.service.js"
import { findLiveStoreBySlug, getStoreForManager } from "../stores/store.service.js"
import {
  CATEGORY_LOCATIONS_INCLUDE,
  categorySoldAt,
  publicCategory,
  viewerLocationId,
} from "./category.service.js"
import { ProductLocation } from "./catalogLocation.model.js"
import { toItemQty } from "../../shared/utils/stockUnit.util.js"
import { applyStockDelta, loadLocation } from "./productStock.service.js"
import { freeBarcode } from "../../shared/utils/barcode.util.js"
import { storeTaxMatcher } from "../taxes/tax.service.js"
import {
  BRANCH_ROLES,
  locationScopeView,
  replaceLocationLinks,
  resolveStoreLocations,
  soldAt,
} from "../../shared/utils/locationScope.util.js"

const categoryInclude = {
  model: Category,
  attributes: [
    "id",
    "name",
    "slug",
    "is_web_visible",
    "is_active",
    "tax_type",
    "tax_value",
    "tax_name",
    "discount_type",
    "discount_value",
    "discount_name",
    "category_number",
    "location_scope",
  ],
  include: [CATEGORY_LOCATIONS_INCLUDE],
}

const PRODUCT_LOCATIONS_INCLUDE = {
  model: ProductLocation,
  as: "productLocations",
  attributes: ["location_id"],
  include: [{ model: Location, attributes: ["id", "location_id_int", "name"] }],
}

// A parent's variants (each a product of its own), oldest first.
const VARIANTS_INCLUDE = {
  model: Product,
  as: "variants",
  attributes: [
    "id", "product_number", "variant_number", "variant_name", "title", "sku", "barcode", "cost_price", "selling_price", "is_active",
    "is_pack_product", "pack_size", "pack_cost_price", "pack_selling_price", "sell_loose", "variant_taxes", "taxes",
    "low_stock_threshold", "is_weight_based", "featured_image", "colors",
  ],
  // A deleted variant (soft delete) is left out.
  where: { deleted_at: null },
  separate: true,
  order: [["variant_number", "ASC"], ["product_number", "ASC"]],
}

/** A JSON column that may come back as text. */
function jsonList(value) {
  if (Array.isArray(value)) return value
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

/**
 * A manager / cashier makes products for their own location only: sold there, stocked there.
 * On an edit they cannot change where it is sold or stocked.
 */
function productScopeForActor(actor, fields, { creating }) {
  if (!BRANCH_ROLES.has(actor?.role)) return fields
  if (!actor.location_id) throw new ForbiddenError("Your account has no location")
  const { location_scope: _scope, location_ids: _ids, stock_scope: _stock, stock_location_ids: _stockIds, ...rest } = fields
  if (!creating) return rest
  return { ...rest, location_scope: "selected", location_ids: [actor.location_id], stock_scope: "all" }
}

/** Every active location of the store, by number. */
async function storeLocations(storeId) {
  return Location.findAll({
    where: { store_id: storeId, is_active: true },
    attributes: ["id", "location_id_int", "name"],
    order: [["location_id_int", "ASC"]],
  })
}

/**
 * Where a product is sold (its location_scope) and, out of those, where its stock is held (its
 * stock_scope: all = every location it is sold at). A variant follows its parent.
 */
export async function stockPlaces(product, actor = null) {
  const json = product.toJSON ? product.toJSON() : product
  let owner = json
  if (json.parent_product_id) {
    const parent = await Product.findByPk(json.parent_product_id, { include: [PRODUCT_LOCATIONS_INCLUDE] })
    if (parent) owner = parent.toJSON()
  }
  const all = await storeLocations(json.store_id)
  const soldIds =
    (owner.location_scope || "all") === "selected" ? new Set((owner.productLocations || []).map((link) => link.location_id)) : null
  const sold = soldIds ? all.filter((row) => soldIds.has(row.id)) : all
  const stockIds = owner.stock_scope === "selected" ? new Set(jsonList(owner.stock_location_ids)) : null
  let held = stockIds ? sold.filter((row) => stockIds.has(row.id)) : sold
  // A manager / cashier only works with their own location.
  if (BRANCH_ROLES.has(actor?.role)) held = held.filter((row) => row.id === actor.location_id)
  return { sold, held }
}

/** stock_location_ids for the row: UUIDs, only locations the product is sold at. */
async function stockScopeColumns(storeId, stock_scope, stock_location_ids, soldIds, warnings, transaction) {
  if (stock_scope !== "selected") return { stock_scope: "all", stock_location_ids: null }
  const ids = await resolveStoreLocations(storeId, stock_location_ids, transaction)
  const kept = soldIds ? ids.filter((id) => soldIds.includes(id)) : ids
  if (kept.length < ids.length) warnings.push("stock_location_ids: a location the product is not sold at was left out")
  return { stock_scope: "selected", stock_location_ids: kept }
}

/**
 * Stock of one sellable product (a variant, or a product without variants) per location.
 * - mode "opening" (create, a new variant, a new stock location): each qty is added as
 *   stock_in / opening_balance; every stock location gets a stock row (qty 0 when none was sent).
 * - mode "count" (edit): qty is what was counted; the difference is written as adjustment / count.
 * A location that does not hold the product's stock is skipped and named in warnings.
 */
async function applyProductStock({ store, target, rows, held, actor, mode, warnings, label, fallbackRef }) {
  const byRef = new Map()
  for (const location of held) {
    byRef.set(location.id, location)
    byRef.set(String(location.location_id_int), location)
  }
  const wanted = new Map()
  for (const row of rows || []) {
    const ref = row.location ?? fallbackRef ?? actor?.location_id ?? store.default_location_id ?? (held.length === 1 ? held[0].id : null)
    const location = ref == null ? null : byRef.get(String(ref))
    if (!location) {
      warnings.push(`${label}: location ${ref ?? "(none)"} does not hold this product's stock, skipped`)
      continue
    }
    // stock_unit pack: qty is whole packs; stock is kept in loose items (packs × pack_size).
    let qty
    try {
      qty = toItemQty(target, Number(row.qty), row.stock_unit)
    } catch (err) {
      warnings.push(`${label}: ${err.message}, skipped`)
      continue
    }
    wanted.set(location.id, { location, qty, expiry_date: row.expiry_date })
  }
  const entries =
    mode === "opening" ? held.map((location) => wanted.get(location.id) || { location, qty: 0 }) : [...wanted.values()]
  if (!entries.length) return
  await sequelize.transaction(async (transaction) => {
    for (const entry of entries) {
      let delta = Number(entry.qty)
      if (mode === "count") {
        const current = await ProductStock.findOne({
          where: { location_id: entry.location.id, product_id: target.id },
          attributes: ["qty"],
          transaction,
        })
        delta = Number(entry.qty) - Number(current?.qty || 0)
      }
      await applyStockDelta(
        {
          storeId: store.id,
          storeIdInt: store.store_id_int,
          location: entry.location,
          productId: target.id,
          delta,
          movement_type: mode === "count" ? "adjustment" : "stock_in",
          reason: mode === "count" ? "count" : "opening_balance",
          reason_note: mode === "count" ? `Stock count of ${target.title}` : `Opening stock of ${target.title}`,
          staff_id: actor?.id || null,
          ...(entry.expiry_date ? { expiry_date: entry.expiry_date } : {}),
        },
        { transaction }
      )
    }
  })
}

/** Sold at locationId: the product's own locations and its category's both include it. */
export function productSoldAt(product, locationId) {
  const json = product?.toJSON ? product.toJSON() : product
  if (!soldAt(json, json?.productLocations, locationId)) return false
  return !json?.Category || categorySoldAt(json.Category, locationId)
}

function skuFromTitle(title) {
  return slugify(title).toUpperCase()
}

async function ensureUniqueSku(storeId, title, excludeId) {
  const root = skuFromTitle(title)
  if (!root) throw new AppError("title must contain letters or numbers for a SKU", 400)
  let sku = root
  let n = 2
  while (true) {
    const existing = await Product.findOne({
      where: {
        store_id: storeId,
        sku,
        ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
      },
    })
    if (!existing) return sku
    sku = `${root}-${n++}`
  }
}

function assertPackRules(fields, current = {}) {
  const is_pack = fields.is_pack_product ?? current.is_pack_product
  const pack_size = fields.pack_size !== undefined ? fields.pack_size : current.pack_size
  const pack_cost_price =
    fields.pack_cost_price !== undefined ? fields.pack_cost_price : current.pack_cost_price
  const pack_selling_price =
    fields.pack_selling_price !== undefined ? fields.pack_selling_price : current.pack_selling_price

  if (is_pack && (!pack_size || pack_size < 2)) {
    throw new AppError("pack_size must be >= 2 for pack products", 400)
  }
  if (is_pack && !(pack_cost_price > 0)) {
    throw new AppError("pack_cost_price is required for pack products", 400)
  }
  if (is_pack && !(pack_selling_price > 0)) {
    throw new AppError("pack_selling_price is required for pack products", 400)
  }
}

const round2 = (n) => Math.round(Number(n) * 100) / 100

/**
 * total_price_each_unit / total_pack_price: the price after this product's own discount, then
 * its own taxes on the discounted price. Fixed amounts are per unit (× pack_size for the pack).
 */
function productTotals(p) {
  const taxes = productTaxList(p)
  const discountOn = (base, units) => {
    const value = Number(p.discount_value)
    if (!p.has_product_discount || !p.discount_type || p.discount_value == null || !(value > 0))
      return 0
    return Math.min(base, p.discount_type === "percentage" ? (base * value) / 100 : value * units)
  }
  const total = (base, units) => {
    const net = base - discountOn(base, units)
    return round2(net + taxes.reduce((sum, tax) => sum + taxOn(net, tax.type, tax.value, units), 0))
  }
  const unit = p.selling_price == null ? null : total(Number(p.selling_price), 1)
  const packSize = Number(p.pack_size)
  const pack =
    p.is_pack_product && p.pack_selling_price != null && packSize >= 2
      ? total(Number(p.pack_selling_price), packSize)
      : null
  return { total_price_each_unit: unit, total_pack_price: pack }
}

// Fields that change total_price_each_unit / total_pack_price.
const TOTAL_FIELDS = [
  "selling_price",
  "pack_selling_price",
  "pack_size",
  "is_pack_product",
  "has_product_discount",
  "discount_type",
  "discount_value",
  "taxes",
]

/** Pack product: cost_price / selling_price of one unit = pack price ÷ pack_size. */
function unitPricesFromPack({ pack_size, pack_cost_price, pack_selling_price }) {
  const size = Number(pack_size)
  return {
    cost_price: round2(Number(pack_cost_price) / size),
    selling_price: round2(Number(pack_selling_price) / size),
  }
}

// The client normally doesn't send has_product_discount (the docs checkbox only adds/removes the
// discount fields), so it's on whenever a discount is actually configured. An explicit value wins.
function deriveHasDiscount(explicit, type, value) {
  if (explicit !== undefined && explicit !== null) return Boolean(explicit)
  return Boolean(type) && value != null
}

function numberOfPacks(qty, packSize) {
  const size = Number(packSize)
  const amount = Number(qty)
  if (!size || size < 2 || Number.isNaN(amount)) return null
  return Math.floor(amount / size)
}

export function expiryStatus(expiryDate, warningDays, criticalDays) {
  if (!expiryDate) return "ok"
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const exp = new Date(expiryDate)
  exp.setHours(0, 0, 0, 0)
  if (exp < today) return "expired"

  const criticalEnd = new Date(today)
  criticalEnd.setDate(criticalEnd.getDate() + Number(criticalDays || 0))
  if (exp <= criticalEnd) return "critical"

  const warningEnd = new Date(criticalEnd)
  warningEnd.setDate(warningEnd.getDate() + Number(warningDays || 0))
  if (exp <= warningEnd) return "warning"
  return "ok"
}

function publicStock(row, product) {
  if (!row) return null
  const qty = Number(row.qty)
  const threshold = row.low_stock_threshold ?? product?.low_stock_threshold
  const location = row.Location || null
  return {
    id: row.id,
    location_id: row.location_id,
    location_number: row.location_id_int,
    location_name: location?.name || null,
    product_id: row.product_id,
    expiry_date: row.expiry_date || null,
    qty,
    unit_sold: Number(row.unit_sold || 0),
    low_stock_threshold: row.low_stock_threshold,
    effective_threshold: threshold == null ? null : Number(threshold),
    is_low: threshold == null ? false : qty <= Number(threshold),
    number_of_packs: numberOfPacks(qty, product?.pack_size),
    // Its lots, soonest expiry first: [{ id (lot number), qty, expiry_date, days_left, expiry_status, received_at, source }].
    ...(row._lots ? { lots: row._lots.map((lot) => publicLot(lot)) } : {}),
    ...publicVisibility(row),
  }
}

function publicProduct(product, extras = {}) {
  const json = product.toJSON ? product.toJSON() : product
  return {
    id: json.id,
    store_id: json.store_id,
    store_number: json.store_id_int,
    product_number: json.product_number,
    category_id: json.category_id,
    category: json.Category
      ? {
          id: json.Category.id,
          category_number: json.Category.category_number ?? null,
          name: json.Category.name,
          slug: json.Category.slug,
          tax_type: json.Category.tax_type || null,
          tax_value: json.Category.tax_value == null ? null : Number(json.Category.tax_value),
          tax_name: json.Category.tax_name || null,
          discount_type: json.Category.discount_type || null,
          discount_value:
            json.Category.discount_value == null ? null : Number(json.Category.discount_value),
          discount_name: json.Category.discount_name || null,
          ...locationScopeView(json.Category, json.Category.categoryLocations),
        }
      : null,
    title: json.title,
    // Variants: a parent lists them (has_variants, variants[]); a variant names its parent.
    parent_product_id: json.parent_product_id || null,
    variant_name: json.variant_name || null,
    variant_number: json.variant_number ?? null,
    has_variants: Boolean(json.has_variants),
    variants: (json.variants || []).map((row) => ({
      id: row.id,
      // Its number inside this product: 1, 2, 3…
      variant_number: row.variant_number ?? null,
      product_number: row.product_number,
      name: row.variant_name,
      title: row.title,
      sku: row.sku,
      barcode: row.barcode,
      cost_price: row.cost_price == null ? null : Number(row.cost_price),
      selling_price: row.selling_price == null ? null : Number(row.selling_price),
      is_pack_product: Boolean(row.is_pack_product),
      pack_size: row.pack_size ?? null,
      pack_cost_price: row.pack_cost_price == null ? null : Number(row.pack_cost_price),
      pack_selling_price: row.pack_selling_price == null ? null : Number(row.pack_selling_price),
      sell_loose: Boolean(row.sell_loose),
      is_weight_based: Boolean(row.is_weight_based),
      // Its own taxes (on top of the product's); taxes = everything it is charged.
      variant_taxes: Array.isArray(row.variant_taxes) ? row.variant_taxes : [],
      taxes: productTaxList(row),
      // Its own image (one per variant); null = none (the product's image is shown instead).
      image: row.featured_image || null,
      // The colours it comes in (hex codes).
      colors: jsonList(row.colors),
      is_active: row.is_active,
    })),
    variant_taxes: Array.isArray(json.variant_taxes) ? json.variant_taxes : [],
    slug: json.slug,
    sku: json.sku,
    barcode: json.barcode,
    // image_url is no longer a column; still returned (= featured_image) for older clients.
    image_url: json.featured_image || null,
    images: Array.isArray(json.images) ? json.images : [],
    featured_image: json.featured_image || null,
    // The colours it comes in, as hex codes: ["#E11D48", "#2563EB"].
    colors: jsonList(json.colors),
    description: json.description,
    unit: json.unit,
    cost_price: json.cost_price,
    selling_price: json.selling_price,
    has_product_discount: json.has_product_discount,
    discount_type: json.discount_type,
    discount_value: json.discount_value,
    discount_name: json.discount_name,
    taxes: productTaxList(json),
    is_pack_product: json.is_pack_product,
    pack_size: json.pack_size,
    pack_cost_price: json.pack_cost_price == null ? null : Number(json.pack_cost_price),
    pack_selling_price: json.pack_selling_price == null ? null : Number(json.pack_selling_price),
    sell_loose: json.sell_loose,
    is_weight_based: json.is_weight_based,
    has_bulk_discount: json.has_bulk_discount,
    total_price_each_unit:
      json.total_price_each_unit == null ? null : Number(json.total_price_each_unit),
    total_pack_price: json.total_pack_price == null ? null : Number(json.total_pack_price),
    low_stock_threshold: json.low_stock_threshold,
    // "all" = every location; "selected" = only location_ids.
    ...locationScopeView(json, json.productLocations),
    // Which of those locations hold its stock: all, or selected = stock_location_ids.
    stock_scope: json.stock_scope || "all",
    stock_location_ids: json.stock_scope === "selected" ? jsonList(json.stock_location_ids) : [],
    is_published: json.is_published,
    ...publicVisibility(json),
    is_active: json.is_active,
    created_at: json.created_at,
    updated_at: json.updated_at,
    ...extras,
  }
}

function publicWebProduct(product, extras = {}) {
  const row = publicProduct(product, extras)
  delete row.cost_price
  delete row.pack_cost_price
  return row
}

async function assertUnique(storeId, field, value, excludeId, excludeIds = []) {
  if (value == null || value === "") return
  const skip = [excludeId, ...excludeIds].filter(Boolean)
  const existing = await Product.findOne({
    where: {
      store_id: storeId,
      [field]: value,
      ...(skip.length ? { id: { [Op.notIn]: skip } } : {}),
    },
  })
  if (existing) {
    const label = field === "sku" ? "SKU" : field
    throw new ConflictError(`Product ${label} already exists`)
  }
}

async function resolveCategory(storeId, categoryId) {
  const category = await Category.findOne({
    where: { id: categoryId, store_id: storeId },
  })
  if (!category) throw new NotFoundError("Category not found")
  return category
}

// Product create takes category_id as either the category's internal UUID or its short
// category_number under the same key — whichever it turns out to be. PATCH still uses
// resolveCategory() above (UUID only).
async function resolveCategoryFlexible(storeId, idOrNumber) {
  const isNumber = /^\d+$/.test(String(idOrNumber))
  const where = isNumber
    ? { category_number: Number(idOrNumber), store_id: storeId }
    : { id: idOrNumber, store_id: storeId }
  const category = await Category.findOne({ where, include: [CATEGORY_LOCATIONS_INCLUDE] })
  if (!category) throw new NotFoundError("Category not found")
  return category
}

export async function getProduct(storeId, id) {
  const product = await Product.findOne({
    where: { id, store_id: storeId, deleted_at: null },
    include: [categoryInclude, PRODUCT_LOCATIONS_INCLUDE, VARIANTS_INCLUDE],
  })
  if (!product) throw new NotFoundError("Product not found")
  return product
}

// Stock movement create takes the short product_number from the client instead of the internal
// UUID.
export async function getProductByNumber(storeId, productNumber) {
  const product = await Product.findOne({
    where: { product_number: productNumber, store_id: storeId },
    include: [categoryInclude, PRODUCT_LOCATIONS_INCLUDE, VARIANTS_INCLUDE],
  })
  if (!product) throw new NotFoundError("Product not found")
  return product
}

async function attachStocks(products, actor, locationId) {
  const ids = products.flatMap((p) => [p.id, ...(p.variants || []).map((v) => v.id)])
  if (!ids.length) return products.map((p) => publicProduct(p, { stocks: [] }))
  const locations = await storeLocations(actor.store_id)
  const locationById = new Map(locations.map((row) => [row.id, row]))
  // Store taxes (Taxes page): every product, or the ones they list.
  const taxesFor = await storeTaxMatcher(actor.store_id)

  const where = { store_id: actor.store_id, product_id: { [Op.in]: ids } }
  if (actor.role !== "store_admin") {
    where.location_id = actor.location_id
  } else if (locationId) {
    where.location_id = locationId
  }

  const rows = await ProductStock.findAll({
    where,
    include: [{ model: Location, attributes: ["id", "name", "location_id_int"] }],
  })
  // Each stock row with its lots (soonest expiry first).
  const lotMap = await lotsByStock(rows)
  for (const row of rows) row._lots = lotMap.get(`${row.location_id}|${row.product_id}`) || []
  const byProduct = new Map()
  for (const row of rows) {
    const list = byProduct.get(row.product_id) || []
    list.push(row)
    byProduct.set(row.product_id, list)
  }

  const sortStocks = (list) => list.sort((a, b) => Number(a.location_number || 0) - Number(b.location_number || 0))
  const statusOf = (stocks) => {
    // Stock in the locations shown: total and in / low / out.
    const total_qty = money(stocks.reduce((sum, row) => sum + Number(row.qty || 0), 0))
    return { total_qty, stock_status: total_qty <= 0 ? "out" : stocks.some((row) => row.is_low) ? "low" : "in" }
  }
  return products.map((product) => {
    const json = product.toJSON ? product.toJSON() : product
    const stockIds = json.stock_scope === "selected" ? jsonList(json.stock_location_ids) : null
    // The locations holding its stock (availability), as numbers and names.
    const stock_locations = (stockIds || []).map((id) => locationById.get(id)).filter(Boolean)
      .map((row) => ({ id: row.id, location_number: row.location_id_int, name: row.name }))
    const variantStocks = new Map(
      (product.variants || []).map((variant) => [
        variant.id,
        sortStocks((byProduct.get(variant.id) || []).map((row) => publicStock(row, variant))),
      ])
    )
    const own = sortStocks((byProduct.get(product.id) || []).map((row) => publicStock(row, product)))
    const all = product.has_variants ? [...variantStocks.values()].flat() : own
    const view = publicProduct(product, {
      stocks: own,
      ...statusOf(all),
      stock_locations,
      store_taxes: taxesFor(json, json.parent_product_id),
    })
    view.variants = view.variants.map((variant) => {
      const stocks = variantStocks.get(variant.id) || []
      return { ...variant, stocks, ...statusOf(stocks), store_taxes: taxesFor(variant, product.id) }
    })
    return view
  })
}

export async function listProducts(actor, query = {}, { parentsOnly = false } = {}) {
  const where = { store_id: actor.store_id }
  if (parentsOnly) where.parent_product_id = null
  // category_id: the category's UUID or its category_number.
  const categoryRef = query.categoryId || query.category_id
  if (categoryRef) {
    // An unknown category just matches no products (as before), not a 404.
    const category = await resolveCategoryFlexible(actor.store_id, categoryRef).catch(() => null)
    if (!category) return []
    where.category_id = category.id
  }
  if (query.q) {
    const q = `%${String(query.q).trim()}%`
    where[Op.or] = [
      { title: { [Op.like]: q } },
      { sku: { [Op.like]: q } },
      { barcode: { [Op.like]: q } },
    ]
    if (parentsOnly) {
      // A variant's barcode / SKU finds its product.
      const matches = await Product.findAll({
        where: {
          store_id: actor.store_id,
          parent_product_id: { [Op.ne]: null },
          deleted_at: null,
          [Op.or]: [{ sku: { [Op.like]: q } }, { barcode: { [Op.like]: q } }, { variant_name: { [Op.like]: q } }],
        },
        attributes: ["parent_product_id"],
      })
      if (matches.length) where[Op.or].push({ id: { [Op.in]: [...new Set(matches.map((row) => row.parent_product_id))] } })
    }
  }

  const products = await Product.findAll({
    where,
    include: [categoryInclude, PRODUCT_LOCATIONS_INCLUDE, VARIANTS_INCLUDE],
    order: [["created_at", "DESC"]],
  })
  // Only what is sold at the location read (a store admin without location_id sees every product).
  const soldHere = viewerLocationId(actor, query)
  const listed = products.filter((product) => productSoldAt(product, soldHere))
  return attachStocks(listed, actor, query.locationId || query.location_id)
}

/**
 * The figures of the product detail screen, worked out here so every client shows the same
 * numbers: one unit's price after the product and category discounts and the taxes on it (as a
 * sale would charge them), and the stock in the locations shown (quantity, packs, value).
 */
function productSummary(store, product, stocks) {
  const category = product.Category || null
  const cost = Number(product.cost_price || 0)
  const selling = Number(product.selling_price || 0)
  const { own, fromCategory } = unitDiscountParts(product, category)
  const net = money(selling - own - fromCategory)
  const tax = lineTaxBreakdown(store, product, category, net, 1)
  // lineTaxBreakdown lists the product's own taxes first, then the Taxes page ones (store_taxes).
  const ownCount = productTaxList(product).length
  const ownTaxes = tax.product_taxes.slice(0, ownCount)
  const storeTaxes = tax.product_taxes.slice(ownCount)
  const sumOf = (list) => money(list.reduce((sum, row) => sum + Number(row.amount || 0), 0))
  // The old store-wide sales tax is not charged any more (Taxes page taxes replace it).
  const salesTaxOn = store?.sales_tax_enabled !== false && Number(tax.sales_tax_amount) > 0

  const qty = money(stocks.reduce((sum, row) => sum + Number(row.qty || 0), 0))
  const packSize = Number(product.pack_size || 0)
  const isPack = Boolean(product.is_pack_product) && packSize >= 2
  const packs = isPack ? Math.floor(qty / packSize) : null
  const unitsInPacks = isPack ? packs * packSize : qty

  return {
    pricing: {
      cost_price: money(cost),
      selling_price: money(selling),
      product_discount_amount: own,
      category_discount_amount: fromCategory,
      discount_amount: money(own + fromCategory),
      price_after_discount: net,
      // The product's own taxes, and the Taxes page taxes that apply to it — each with its amount.
      product_taxes: ownTaxes,
      product_tax_amount: sumOf(ownTaxes),
      store_taxes: storeTaxes,
      store_tax_amount: sumOf(storeTaxes),
      category_tax_amount: tax.category_tax_amount,
      sales_tax_rate: salesTaxOn ? tax.sales_tax_rate : null,
      sales_tax_amount: salesTaxOn ? tax.sales_tax_amount : 0,
      tax_amount: tax.tax_amount,
      price_with_tax: money(net + tax.tax_amount),
      taxes_charged: Boolean(store?.charge_tax_on_sales),
      profit_per_unit: money(net - cost),
      margin_percent: net > 0 ? money(((net - cost) / net) * 100) : 0,
    },
    stock: {
      locations: stocks.length,
      low_stock_locations: stocks.filter((row) => row.is_low).length,
      total_qty: qty,
      unit_sold: money(stocks.reduce((sum, row) => sum + Number(row.unit_sold || 0), 0)),
      pack_size: isPack ? packSize : null,
      number_of_packs: packs,
      units_in_full_packs: money(unitsInPacks),
      loose_units: money(qty - unitsInPacks),
      cost_value: money(qty * cost),
      selling_value: money(qty * selling),
      full_packs_cost_value: money(unitsInPacks * cost),
      full_packs_selling_value: money(unitsInPacks * selling),
    },
  }
}

/** One product with its stock; summary (the detail figures) is added for the dashboard only. */
export async function getProductView(actor, id, query = {}, { withSummary = true } = {}) {
  // id: the product's UUID or its number (as the POS sends it).
  const product = /^\d+$/.test(String(id)) ? await getProductByNumber(actor.store_id, Number(id)) : await getProduct(actor.store_id, id)
  if (BRANCH_ROLES.has(actor?.role) && !productSoldAt(product, actor.location_id)) {
    throw new NotFoundError("Product not found")
  }
  const [view] = await attachStocks([product], actor, query.locationId || query.location_id)
  if (!withSummary) {
    // The POS reply stays as it was.
    delete view.total_qty
    delete view.stock_status
    return view
  }
  const store = pricingStore(await getStoreForManager(actor.store_id))
  // A product with variants: its figures cover every variant's stock.
  const stocks = product.has_variants ? view.variants.flatMap((variant) => variant.stocks) : view.stocks
  product.store_taxes = view.store_taxes
  return { ...view, summary: productSummary(store, product, stocks) }
}

/**
 * Dashboard category detail: the category (by UUID or category_number), every product in it with
 * its stock in the locations the user sees, and the category's totals.
 */
export async function getCategoryDetail(actor, idOrNumber, query = {}) {
  const category = await resolveCategoryFlexible(actor.store_id, idOrNumber)
  if (BRANCH_ROLES.has(actor?.role) && !categorySoldAt(category, actor.location_id)) {
    throw new NotFoundError("Category not found")
  }
  const products = await listProducts(actor, { ...query, category_id: category.id }, { parentsOnly: true })
  let totalQty = 0
  let costValue = 0
  let sellingValue = 0
  let lowStock = 0
  for (const product of products) {
    totalQty += product.total_qty
    costValue += product.total_qty * Number(product.cost_price || 0)
    sellingValue += product.total_qty * Number(product.selling_price || 0)
    if (product.stock_status === "low") lowStock += 1
  }
  return {
    ...publicCategory(category),
    summary: {
      products: products.length,
      active_products: products.filter((row) => row.is_active).length,
      inactive_products: products.filter((row) => !row.is_active).length,
      low_stock_products: lowStock,
      out_of_stock_products: products.filter((row) => row.stock_status === "out").length,
      total_qty: money(totalQty),
      cost_value: money(costValue),
      selling_value: money(sellingValue),
    },
    products,
  }
}

/** The variant products a parent's variants[] asks for: checks every barcode / SKU first. */
async function assertVariantsFree(storeId, variants, excludeIds = []) {
  for (const variant of variants) {
    if (variant.sku) await assertUnique(storeId, "sku", variant.sku, null, excludeIds)
  }
}

/** A variant's taxes: the parent's, then its own. */
const variantTaxList = (parentTaxes, own) => [...(parentTaxes || []), ...(own || [])]

/** One variant of a parent: a product of its own (the parent's category, taxes, unit, scope…). */
async function createVariant(store, parent, variant, variantNumber) {
  const json = parent.toJSON ? parent.toJSON() : parent
  return createProduct(
    store,
    {
      title: `${json.title} - ${variant.name}`,
      variant_name: variant.name,
      variant_number: variantNumber,
      parent_product_id: json.id,
      sku: variant.sku,
      barcode: variant.barcode,
      category_id: json.category_id,
      description: json.description,
      unit: json.unit,
      cost_price: variant.cost_price,
      selling_price: variant.selling_price,
      taxes: variantTaxList(productTaxList(json), variant.taxes),
      variant_taxes: variant.taxes || [],
      colors: variant.colors || [],
      // Its own image (a URL), when sent.
      featured_image: variant.image || null,
      images: variant.image ? [{ url: variant.image }] : [],
      is_pack_product: Boolean(variant.is_pack_product),
      pack_size: variant.is_pack_product ? variant.pack_size : null,
      pack_cost_price: variant.is_pack_product ? variant.pack_cost_price : null,
      pack_selling_price: variant.is_pack_product ? variant.pack_selling_price : null,
      sell_loose: Boolean(variant.sell_loose),
      is_weight_based: variant.is_weight_based ?? Boolean(json.is_weight_based),
      has_bulk_discount: false,
      low_stock_threshold: json.low_stock_threshold,
      is_published: json.is_published,
      is_pos_visible: json.is_pos_visible,
      is_web_visible: json.is_web_visible,
      channel: json.channel,
      is_active: variant.is_active ?? json.is_active,
      location_scope: json.location_scope || "all",
      location_ids: (json.productLocations || []).map((link) => link.location_id),
    },
    null
  )
}

/** The next variant number of a product: 1 for the first, then max + 1 (never reused). */
async function nextVariantNumber(parentId) {
  const max = await Product.max("variant_number", { where: { parent_product_id: parentId } })
  return Number(max || 0) + 1
}

export async function createProduct(store, input, actor = null) {
  const { location_ids, variants, stock_location_id, stock, stock_scope, stock_location_ids, ...fields } =
    productScopeForActor(actor, input, { creating: true })
  const scope = fields.location_scope || "all"
  const warnings = []
  if (variants?.length) {
    await assertVariantsFree(store.id, variants)
    // The parent's own prices (not sold itself): the first variant's when none were sent.
    // (A pack variant's unit prices = pack price ÷ pack size.)
    const first = variants[0].is_pack_product ? unitPricesFromPack(variants[0]) : variants[0]
    if (fields.cost_price == null && !fields.is_pack_product) fields.cost_price = first.cost_price ?? 0
    if (fields.selling_price == null && !fields.is_pack_product) fields.selling_price = first.selling_price ?? 0
  }
  assertPackRules(fields)
  const slug = await ensureUniqueSlug(fields.title, async (candidate) => {
    const existing = await Product.findOne({
      where: { store_id: store.id, slug: candidate },
    })
    return Boolean(existing)
  })
  if (!slug) throw new AppError("title must contain letters or numbers for a slug", 400)

  const category = await resolveCategoryFlexible(store.id, fields.category_id)
  let sku
  if (fields.sku) {
    await assertUnique(store.id, "sku", fields.sku)
    sku = fields.sku
  } else {
    sku = await ensureUniqueSku(store.id, fields.title)
  }
  // A barcode already in use is replaced with a new one (the create never fails on it).
  const barcodePick = fields.barcode ? await freeBarcode(store.id, fields.barcode) : { barcode: null, replaced: false }
  fields.barcode = barcodePick.barcode

  try {
    const id = await sequelize.transaction(async (transaction) => {
      const locationIds = await resolveStoreLocations(
        store.id,
        scope === "selected" ? location_ids : [],
        transaction
      )
      const stockColumns = await stockScopeColumns(
        store.id,
        stock_scope,
        stock_location_ids,
        scope === "selected" ? locationIds : null,
        warnings,
        transaction
      )
      const created = await Product.create(
        {
          store_id: store.id,
          store_id_int: store.store_id_int,
          // A variant does not use up a product number: it is variant 1, 2, 3… of its product.
          product_number: fields.parent_product_id ? null : await nextProductNumber(store.id, transaction),
          category_id: category.id,
          parent_product_id: fields.parent_product_id || null,
          variant_name: fields.variant_name || null,
          variant_number: fields.variant_number ?? null,
          has_variants: Boolean(variants?.length),
          variant_taxes: fields.variant_taxes || null,
          title: fields.title,
          slug,
          sku,
          barcode: fields.barcode,
          images: fields.images ?? [],
          featured_image: fields.featured_image ?? null,
          description: fields.description,
          unit: fields.unit,
          // A pack product's per-unit prices are always pack price ÷ pack_size (assertPackRules
          // above guarantees both are present); anything sent for them is ignored.
          ...(fields.is_pack_product
            ? unitPricesFromPack(fields)
            : { cost_price: fields.cost_price, selling_price: fields.selling_price }),
          has_product_discount: deriveHasDiscount(
            fields.has_product_discount,
            fields.discount_type,
            fields.discount_value
          ),
          discount_type: fields.discount_type,
          discount_value: fields.discount_value,
          discount_name: fields.discount_name,
          taxes: fields.taxes || [],
          is_pack_product: fields.is_pack_product,
          pack_size: fields.is_pack_product ? fields.pack_size : null,
          pack_cost_price: fields.is_pack_product ? fields.pack_cost_price : null,
          pack_selling_price: fields.is_pack_product ? fields.pack_selling_price : null,
          sell_loose: fields.sell_loose,
          is_weight_based: fields.is_weight_based,
          colors: fields.colors || [],
          has_bulk_discount: fields.has_bulk_discount,
          low_stock_threshold: fields.low_stock_threshold,
          is_published: fields.is_published,
          is_pos_visible: fields.is_pos_visible,
          is_web_visible: fields.is_web_visible,
          channel: fields.channel,
          is_active: fields.is_active,
          location_scope: scope,
          ...stockColumns,
        },
        { transaction }
      )
      await created.update(productTotals(created), { transaction })
      await replaceLocationLinks(ProductLocation, "product_id", created, locationIds, transaction)
      return created.id
    })
    // Opening stock: every variant (or the product itself) at each location holding its stock.
    if (!fields.parent_product_id) {
      const parent = await getProduct(store.id, id)
      const { held } = await stockPlaces(parent, actor)
      if (variants?.length) {
        let number = 0
        for (const variant of variants) {
          const view = await createVariant(store, parent, variant, ++number)
          await applyProductStock({
            store, target: view, rows: variant.stock, held, actor, mode: "opening", warnings,
            label: `variant ${variant.name}`, fallbackRef: stock_location_id,
          })
        }
      } else {
        await applyProductStock({
          store, target: parent, rows: stock, held, actor, mode: "opening", warnings, label: "stock", fallbackRef: stock_location_id,
        })
      }
    }
    if (fields.parent_product_id) return publicProduct(await getProduct(store.id, id))
    const [view] = await attachStocks([await getProduct(store.id, id)], actor)
    return {
      ...view,
      ...(barcodePick.replaced ? { barcode_replaced: { requested: input.barcode, used: barcodePick.barcode } } : {}),
      ...(warnings.length ? { stock_warnings: warnings } : {}),
    }
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new ConflictError("Product slug, SKU, or barcode already exists")
    }
    throw err
  }
}

/** PATCH variants[]: an id changes that variant of this product; no id adds a new variant. */
async function saveVariants(storeId, product, variants, actor, { held, warnings, stockLocationRef }) {
  const store = await getStoreForManager(storeId)
  const own = await Product.findAll({ where: { store_id: storeId, parent_product_id: product.id, deleted_at: null } })
  // id = the variant's number inside this product (1, 2, 3…) or its UUID.
  const findOwn = (ref) => own.find((row) => row.id === ref || String(row.variant_number) === String(ref))
  const changing = variants.filter((v) => v.ref).map((v) => findOwn(v.ref)?.id).filter(Boolean)
  await assertVariantsFree(storeId, variants.filter((v) => !v.ref))
  for (const variant of variants.filter((v) => v.ref)) {
    const row = findOwn(variant.ref)
    if (!row) throw new NotFoundError(`Variant ${variant.ref} is not a variant of this product`)
    if (variant.sku) await assertUnique(storeId, "sku", variant.sku, row.id)
  }
  const parentTaxes = productTaxList(product)
  for (const variant of variants) {
    if (!variant.ref) {
      const view = await createVariant(store, await getProduct(storeId, product.id), variant, await nextVariantNumber(product.id))
      await applyProductStock({
        store, target: view, rows: variant.stock, held, actor, mode: "opening", warnings,
        label: `variant ${variant.name}`, fallbackRef: stockLocationRef,
      })
      continue
    }
    const row = findOwn(variant.ref)
    const patch = {}
    if (variant.name) Object.assign(patch, { variant_name: variant.name, title: `${product.title} - ${variant.name}` })
    if (variant.sku) patch.sku = variant.sku
    if (variant.barcode !== undefined) {
      patch.barcode = variant.barcode ? (await freeBarcode(storeId, variant.barcode, [row.id])).barcode : null
    }
    if (variant.cost_price != null) patch.cost_price = variant.cost_price
    if (variant.selling_price != null) patch.selling_price = variant.selling_price
    if (variant.is_active !== undefined) patch.is_active = variant.is_active
    // image: a URL sets the variant's one image, null removes it.
    if (variant.image !== undefined) Object.assign(patch, { featured_image: variant.image, images: variant.image ? [{ url: variant.image }] : [] })
    if (variant.sell_loose !== undefined) patch.sell_loose = variant.sell_loose
    if (variant.is_weight_based !== undefined) patch.is_weight_based = variant.is_weight_based
    if (variant.colors !== undefined) patch.colors = variant.colors
    if (variant.is_pack_product === false) Object.assign(patch, { is_pack_product: false, pack_size: null, pack_cost_price: null, pack_selling_price: null })
    if (variant.is_pack_product || (row.is_pack_product && variant.is_pack_product !== false)) {
      const pack = {
        pack_size: variant.pack_size ?? row.pack_size,
        pack_cost_price: variant.pack_cost_price ?? row.pack_cost_price,
        pack_selling_price: variant.pack_selling_price ?? row.pack_selling_price,
      }
      if (variant.is_pack_product || variant.pack_size != null || variant.pack_cost_price != null || variant.pack_selling_price != null) {
        assertPackRules({ is_pack_product: true, ...pack }, row)
        Object.assign(patch, { is_pack_product: true, ...pack, ...unitPricesFromPack(pack) })
      }
    }
    if (variant.taxes !== undefined) {
      patch.variant_taxes = variant.taxes
      patch.taxes = variantTaxList(parentTaxes, variant.taxes)
    }
    if (Object.keys(patch).length) {
      await row.update(patch)
      await row.update(productTotals(row))
    }
    if (variant.stock !== undefined) {
      await applyProductStock({
        store, target: row, rows: variant.stock, held, actor, mode: "count", warnings,
        label: `variant ${row.variant_number}`, fallbackRef: stockLocationRef,
      })
    }
  }
  if (!product.has_variants) await product.update({ has_variants: true })
  return changing
}

export async function updateProduct(storeId, id, input, actor = null) {
  const product = await getProduct(storeId, id)
  if (BRANCH_ROLES.has(actor?.role) && !productSoldAt(product, actor.location_id)) {
    throw new NotFoundError("Product not found")
  }
  const { location_ids, variants, stock_location_id, stock, stock_scope, stock_location_ids, ...fields } =
    productScopeForActor(actor, input, { creating: false })
  assertPackRules(fields, product)
  const patch = { ...fields }
  const warnings = []
  const placesChange = fields.location_scope !== undefined || stock_scope !== undefined

  if (fields.title !== undefined) {
    const slug = await ensureUniqueSlug(fields.title, async (candidate) => {
      const existing = await Product.findOne({
        where: { store_id: storeId, slug: candidate, id: { [Op.ne]: product.id } },
      })
      return Boolean(existing)
    })
    if (!slug) throw new AppError("title must contain letters or numbers for a slug", 400)
    patch.slug = slug
    if (fields.sku === undefined) {
      patch.sku = await ensureUniqueSku(storeId, fields.title, product.id)
    }
  }
  if (fields.sku !== undefined) await assertUnique(storeId, "sku", fields.sku, product.id)
  if (fields.barcode) {
    patch.barcode = (await freeBarcode(storeId, fields.barcode, [product.id])).barcode
  }
  if (fields.category_id !== undefined) {
    await resolveCategory(storeId, fields.category_id)
  }
  if (fields.is_pack_product === false) {
    patch.pack_size = null
    patch.pack_cost_price = null
    patch.pack_selling_price = null
  }
  // Still (or now) a pack product: keep the per-unit prices derived from the pack.
  const isPack = fields.is_pack_product ?? product.is_pack_product
  if (isPack) {
    Object.assign(
      patch,
      unitPricesFromPack({
        pack_size: fields.pack_size ?? product.pack_size,
        pack_cost_price: fields.pack_cost_price ?? product.pack_cost_price,
        pack_selling_price: fields.pack_selling_price ?? product.pack_selling_price,
      })
    )
  }
  if (
    fields.has_product_discount === undefined &&
    (fields.discount_type !== undefined || fields.discount_value !== undefined)
  ) {
    patch.has_product_discount = deriveHasDiscount(
      undefined,
      fields.discount_type !== undefined ? fields.discount_type : product.discount_type,
      fields.discount_value !== undefined ? fields.discount_value : product.discount_value
    )
  }

  try {
    await sequelize.transaction(async (transaction) => {
      if (fields.location_scope !== undefined) {
        const ids = await resolveStoreLocations(
          storeId,
          fields.location_scope === "selected" ? location_ids : [],
          transaction
        )
        await replaceLocationLinks(ProductLocation, "product_id", product, ids, transaction)
        // Variants are sold where their product is.
        const children = await Product.findAll({ where: { store_id: storeId, parent_product_id: product.id }, transaction })
        for (const child of children) {
          await child.update({ location_scope: fields.location_scope }, { transaction })
          await replaceLocationLinks(ProductLocation, "product_id", child, ids, transaction)
        }
      }
      if (stock_scope !== undefined || fields.location_scope !== undefined) {
        const sold =
          (fields.location_scope ?? product.location_scope) === "selected"
            ? (await ProductLocation.findAll({ where: { product_id: product.id }, attributes: ["location_id"], transaction })).map(
                (row) => row.location_id
              )
            : null
        const scopeNow = stock_scope ?? product.stock_scope
        const idsNow = stock_scope !== undefined ? stock_location_ids : jsonList(product.stock_location_ids)
        Object.assign(patch, await stockScopeColumns(storeId, scopeNow, idsNow, sold, warnings, transaction))
      }
      await product.update(patch, { transaction })
      if (TOTAL_FIELDS.some((key) => patch[key] !== undefined)) {
        await product.update(productTotals(product), { transaction })
      }
    })
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new ConflictError("Product slug, SKU, or barcode already exists")
    }
    throw err
  }
  // A product with variants switched on / off: its variants follow (as on delete).
  if (typeof fields.is_active === "boolean" && product.has_variants) {
    await Product.update({ is_active: fields.is_active }, { where: { store_id: storeId, parent_product_id: product.id, deleted_at: null } })
  }
  // The product's taxes changed: every variant gets them again, plus its own.
  if (fields.taxes !== undefined && product.has_variants) {
    const children = await Product.findAll({ where: { store_id: storeId, parent_product_id: product.id } })
    for (const child of children) {
      await child.update({ taxes: variantTaxList(fields.taxes, child.variant_taxes || []) })
      await child.update(productTotals(child))
    }
  }
  const fresh = await getProduct(storeId, product.id)
  const { held } = await stockPlaces(fresh, actor)
  const store = await getStoreForManager(storeId)
  // A location newly holding the stock gets a stock row (qty 0) for each variant / the product.
  if (placesChange) {
    for (const target of fresh.has_variants ? fresh.variants : [fresh]) {
      await applyProductStock({ store, target, rows: [], held, actor, mode: "opening", warnings, label: "stock" })
    }
  }
  if (variants?.length) {
    await saveVariants(storeId, fresh, variants, actor, { held, warnings, stockLocationRef: stock_location_id })
  }
  if (stock !== undefined) {
    if (fresh.has_variants || variants?.length) warnings.push("stock: a product with variants keeps its stock on each variant")
    else {
      await applyProductStock({
        store, target: fresh, rows: stock, held, actor, mode: "count", warnings, label: "stock", fallbackRef: stock_location_id,
      })
    }
  }
  const [view] = await attachStocks([await getProduct(storeId, product.id)], actor)
  return warnings.length ? { ...view, stock_warnings: warnings } : view
}

// ---- Product image: one image per product ----

/** A product reference from the POS: its number (e.g. 1) or UUID. */
export async function getProductByRef(storeId, ref) {
  const value = String(ref ?? "").trim()
  if (!value) throw new AppError("productId is required", 400)
  return /^\d+$/.test(value) ? getProductByNumber(storeId, Number(value)) : getProduct(storeId, value)
}

const imageView = (product) => ({
  id: product.product_number,
  title: product.title,
  image: product.featured_image || null,
})

export async function getProductImage(storeId, ref) {
  return imageView(await getProductByRef(storeId, ref))
}

/** Sets the product's one image (replaces any earlier one). */
export async function setProductImage(storeId, ref, url) {
  const product = await getProductByRef(storeId, ref)
  await product.update({ featured_image: url, images: url ? [{ url }] : [] })
  return imageView(product)
}

/**
 * One variant of a product: productRef = the product's number or UUID; variantRef = the
 * variant's number inside it (1, 2, 3…) or the variant's UUID.
 */
export async function getVariantByRef(storeId, productRef, variantRef) {
  const product = await getProductByRef(storeId, productRef)
  const ref = String(variantRef ?? "").trim()
  if (!ref) throw new AppError("variantId is required", 400)
  const variant = await Product.findOne({
    where: {
      store_id: storeId,
      parent_product_id: product.id,
      deleted_at: null,
      ...(/^\d+$/.test(ref) ? { variant_number: Number(ref) } : { id: ref }),
    },
  })
  if (!variant) throw new NotFoundError(`Variant ${ref} is not a variant of this product`)
  return { product, variant }
}

const variantImageView = (product, variant) => ({
  id: product.product_number,
  title: product.title,
  variant: {
    id: variant.variant_number,
    name: variant.variant_name,
    image: variant.featured_image || null,
  },
})

/** Sets (url) or removes (null) a variant's one image. */
export async function setVariantImage(storeId, productRef, variantRef, url) {
  const { product, variant } = await getVariantByRef(storeId, productRef, variantRef)
  await variant.update({ featured_image: url, images: url ? [{ url }] : [] })
  return variantImageView(product, variant)
}

/**
 * DELETE /products/:id/variants/:variantId — soft delete of one variant: it is switched off and
 * hidden (its product's variant list, the forms, the stock lists, the POS). Its stock rows, lots,
 * movements and sales stay as they were, so history and reports still name it. Its variant number
 * is not given to a new variant. Returns the product (without it).
 */
export async function deleteVariant(storeId, productRef, variantRef) {
  const { product, variant } = await getVariantByRef(storeId, productRef, variantRef)
  await variant.update({ deleted_at: new Date(), is_active: false, is_pos_visible: false, is_published: false })
  return publicProduct(await getProduct(storeId, product.id))
}

export async function deleteProduct(storeId, id) {
  const product = await getProduct(storeId, id)
  await product.update({ is_active: false, is_published: false, is_pos_visible: false })
  if (product.has_variants) {
    await Product.update({ is_active: false }, { where: { store_id: storeId, parent_product_id: product.id, deleted_at: null } })
  }
  return publicProduct(await getProduct(storeId, id))
}

export async function listWeightProducts(storeId) {
  const rows = await Product.findAll({
    where: { store_id: storeId, is_weight_based: true, deleted_at: null },
    include: [categoryInclude],
    order: [["title", "ASC"]],
  })
  // A variant: its product (number, title) and, without an image of its own, the product's image.
  const parentIds = [...new Set(rows.map((row) => row.parent_product_id).filter(Boolean))]
  const parents = new Map(
    (parentIds.length
      ? await Product.findAll({ where: { store_id: storeId, id: { [Op.in]: parentIds } }, attributes: ["id", "product_number", "title", "featured_image"] })
      : []
    ).map((row) => [row.id, row])
  )
  return rows.map((row) => {
    const parent = row.parent_product_id ? parents.get(row.parent_product_id) : null
    return publicProduct(row, {
      image: row.featured_image || parent?.featured_image || null,
      parent: parent ? { id: parent.id, product_number: parent.product_number, title: parent.title } : null,
    })
  })
}

export async function patchWeight(storeId, id, fields) {
  const product = await getProduct(storeId, id)
  assertPackRules({ is_weight_based: fields.is_weight_based }, product)
  await product.update({ is_weight_based: fields.is_weight_based })
  return publicProduct(await getProduct(storeId, id))
}

/**
 * GET /products/expiry — one row per lot (a product's stock at a location that came in together,
 * with its own expiry date), soonest expiry first: the product, lot { id (lot number), qty,
 * expiry_date, days_left, expiry_status, received_at, source }, location, and the stock of that
 * product there with all its lots (stocks[0]). all=true: lots without an expiry date too (last).
 */
export async function listExpiryProducts(storeId, locationId = null, { all = false } = {}) {
  const store = await getStoreForManager(storeId)
  const lots = await StockLot.findAll({
    where: {
      store_id: storeId,
      deleted_at: null,
      qty: { [Op.gt]: 0 },
      ...(all ? {} : { expiry_date: { [Op.ne]: null } }),
      ...(locationId ? { location_id: locationId } : {}),
    },
    order: [[sequelize.literal("expiry_date IS NULL"), "ASC"], ["expiry_date", "ASC"], ["received_at", "ASC"], ["lot_number", "ASC"]],
  })
  if (!lots.length) return []
  const stocks = await ProductStock.findAll({
    where: {
      store_id: storeId,
      deleted_at: null,
      location_id: { [Op.in]: [...new Set(lots.map((lot) => lot.location_id))] },
      product_id: { [Op.in]: [...new Set(lots.map((lot) => lot.product_id))] },
    },
    include: [
      // A deleted variant's stock is left out of the list (it stays in the database).
      { model: Product, where: { deleted_at: null }, include: [categoryInclude] },
      { model: Location, attributes: ["id", "name", "location_id_int"] },
    ],
  })
  const lotMap = await lotsByStock(stocks)
  const stockOf = new Map(stocks.map((row) => [`${row.location_id}|${row.product_id}`, row]))
  const parentIds = [...new Set(stocks.map((row) => row.Product?.parent_product_id).filter(Boolean))]
  const parentImage = new Map(
    (parentIds.length
      ? await Product.findAll({ where: { store_id: storeId, id: { [Op.in]: parentIds } }, attributes: ["id", "featured_image", "product_number", "title"] })
      : []
    ).map((row) => [row.id, row])
  )
  return lots
    .map((lot) => {
      const stock = stockOf.get(`${lot.location_id}|${lot.product_id}`)
      if (!stock?.Product) return null
      stock._lots = lotMap.get(`${lot.location_id}|${lot.product_id}`) || []
      const view = publicLot(lot, store)
      return publicProduct(stock.Product, {
        stocks: [publicStock(stock, stock.Product)],
        lot: view,
        store_id: stock.store_id,
        store_number: stock.store_id_int,
        location_id: stock.location_id,
        location_number: stock.location_id_int,
        expiry_date: lot.expiry_date || null,
        expiry_status: view.expiry_status,
        // Its own image, else (a variant) its product's image.
        image: stock.Product.featured_image || parentImage.get(stock.Product.parent_product_id)?.featured_image || null,
        // A variant: its product (number + title); the variant is variant_number inside it.
        parent: stock.Product.parent_product_id
          ? (({ id, product_number, title }) => ({ id, product_number, title }))(parentImage.get(stock.Product.parent_product_id) || {})
          : null,
      })
    })
    .filter(Boolean)
}

export async function listBulkTiers(storeId, productId) {
  await getProduct(storeId, productId)
  return ProductBulkTier.findAll({
    where: { store_id: storeId, product_id: productId },
    order: [["min_qty", "ASC"]],
  })
}

export async function replaceBulkTiers(storeId, productId, tiers) {
  const product = await getProduct(storeId, productId)
  await sequelize.transaction(async (transaction) => {
    await ProductBulkTier.destroy({
      where: { store_id: storeId, product_id: productId },
      transaction,
    })
    if (tiers.length) {
      await ProductBulkTier.bulkCreate(
        tiers.map((tier) => ({
          store_id: storeId,
          product_id: productId,
          ...copyVisibility(product),
          ...tier,
        })),
        { transaction }
      )
    }
    await product.update({ has_bulk_discount: tiers.length > 0 }, { transaction })
  })
  return listBulkTiers(storeId, productId)
}

async function requireLiveStore(slug) {
  const store = await findLiveStoreBySlug(slug)
  if (!store) throw new NotFoundError("Store not found")
  return store
}

const publicCategoryInclude = {
  model: Category,
  attributes: ["id", "name", "slug"],
  where: { is_web_visible: true, is_active: true },
  required: true,
}

export async function listPublicProducts(slug, { categoryId } = {}) {
  const store = await requireLiveStore(slug)
  const where = {
    store_id: store.id,
    is_published: true,
    is_web_visible: true,
    is_active: true,
  }
  if (categoryId) where.category_id = categoryId

  const rows = await Product.findAll({
    where,
    include: [publicCategoryInclude],
    order: [["created_at", "DESC"]],
  })
  return rows.map((row) => publicWebProduct(row))
}

export async function getPublicProduct(slug, id) {
  const store = await requireLiveStore(slug)
  const product = await Product.findOne({
    where: {
      id,
      store_id: store.id,
      is_published: true,
      is_web_visible: true,
      is_active: true,
    },
    include: [publicCategoryInclude],
  })
  if (!product) throw new NotFoundError("Product not found")
  return publicWebProduct(product)
}

export { publicProduct, publicStock, numberOfPacks }
