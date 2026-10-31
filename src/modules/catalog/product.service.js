import { Op, UniqueConstraintError } from "sequelize"
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
import { copyVisibility, publicVisibility } from "../../db/channelVisibility.js"
import { Location } from "../locations/location.model.js"
import {
  lineTaxBreakdown,
  money,
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
import {
  BRANCH_ROLES,
  locationScopeView,
  replaceLocationLinks,
  resolveStoreLocations,
  scopeForActor,
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
    slug: json.slug,
    sku: json.sku,
    barcode: json.barcode,
    // image_url is no longer a column; still returned (= featured_image) for older clients.
    image_url: json.featured_image || null,
    images: Array.isArray(json.images) ? json.images : [],
    featured_image: json.featured_image || null,
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

async function assertUnique(storeId, field, value, excludeId) {
  if (value == null || value === "") return
  const existing = await Product.findOne({
    where: {
      store_id: storeId,
      [field]: value,
      ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
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
    where: { id, store_id: storeId },
    include: [categoryInclude, PRODUCT_LOCATIONS_INCLUDE],
  })
  if (!product) throw new NotFoundError("Product not found")
  return product
}

// Stock movement create takes the short product_number from the client instead of the internal
// UUID.
export async function getProductByNumber(storeId, productNumber) {
  const product = await Product.findOne({
    where: { product_number: productNumber, store_id: storeId },
    include: [categoryInclude, PRODUCT_LOCATIONS_INCLUDE],
  })
  if (!product) throw new NotFoundError("Product not found")
  return product
}

async function attachStocks(products, actor, locationId) {
  const ids = products.map((p) => p.id)
  if (!ids.length) return products.map((p) => publicProduct(p, { stocks: [] }))

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
  const byProduct = new Map()
  for (const row of rows) {
    const list = byProduct.get(row.product_id) || []
    list.push(row)
    byProduct.set(row.product_id, list)
  }

  return products.map((product) => {
    const stocks = (byProduct.get(product.id) || []).map((row) => publicStock(row, product))
    // Stock in the locations shown: total and in / low / out.
    const total_qty = money(stocks.reduce((sum, row) => sum + Number(row.qty || 0), 0))
    const stock_status = total_qty <= 0 ? "out" : stocks.some((row) => row.is_low) ? "low" : "in"
    return publicProduct(product, { stocks, total_qty, stock_status })
  })
}

export async function listProducts(actor, query = {}) {
  const where = { store_id: actor.store_id }
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
  }

  const products = await Product.findAll({
    where,
    include: [categoryInclude, PRODUCT_LOCATIONS_INCLUDE],
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
      product_taxes: tax.product_taxes,
      product_tax_amount: tax.product_tax_amount,
      category_tax_amount: tax.category_tax_amount,
      sales_tax_rate: tax.sales_tax_rate,
      sales_tax_amount: tax.sales_tax_amount,
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
  const product = await getProduct(actor.store_id, id)
  if (BRANCH_ROLES.has(actor?.role) && !productSoldAt(product, actor.location_id)) {
    throw new NotFoundError("Product not found")
  }
  const [view] = await attachStocks([product], actor, query.locationId || query.location_id)
  view.stocks.sort((a, b) => Number(a.location_number || 0) - Number(b.location_number || 0))
  if (!withSummary) {
    // The POS reply stays as it was.
    delete view.total_qty
    delete view.stock_status
    return view
  }
  const store = await getStoreForManager(actor.store_id)
  return { ...view, summary: productSummary(store, product, view.stocks) }
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
  const products = await listProducts(actor, { ...query, category_id: category.id })
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

export async function createProduct(store, input, actor = null) {
  const { location_ids, ...fields } = scopeForActor(actor, input, { creating: true })
  const scope = fields.location_scope || "all"
  assertPackRules(fields)
  const slug = await ensureUniqueSlug(fields.title, async (candidate) => {
    const existing = await Product.findOne({
      where: { store_id: store.id, slug: candidate },
    })
    return Boolean(existing)
  })
  if (!slug) throw new AppError("title must contain letters or numbers for a slug", 400)

  const category = await resolveCategoryFlexible(store.id, fields.category_id)
  const sku = await ensureUniqueSku(store.id, fields.title)
  await assertUnique(store.id, "barcode", fields.barcode)

  try {
    const id = await sequelize.transaction(async (transaction) => {
      const locationIds = await resolveStoreLocations(
        store.id,
        scope === "selected" ? location_ids : [],
        transaction
      )
      const created = await Product.create(
        {
          store_id: store.id,
          store_id_int: store.store_id_int,
          product_number: await nextProductNumber(store.id, transaction),
          category_id: category.id,
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
          has_bulk_discount: fields.has_bulk_discount,
          low_stock_threshold: fields.low_stock_threshold,
          is_published: fields.is_published,
          is_pos_visible: fields.is_pos_visible,
          is_web_visible: fields.is_web_visible,
          channel: fields.channel,
          is_active: fields.is_active,
          location_scope: scope,
        },
        { transaction }
      )
      await created.update(productTotals(created), { transaction })
      await replaceLocationLinks(ProductLocation, "product_id", created, locationIds, transaction)
      return created.id
    })
    return publicProduct(await getProduct(store.id, id), { stocks: [] })
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new ConflictError("Product slug, SKU, or barcode already exists")
    }
    throw err
  }
}

export async function updateProduct(storeId, id, input, actor = null) {
  const product = await getProduct(storeId, id)
  if (BRANCH_ROLES.has(actor?.role) && !productSoldAt(product, actor.location_id)) {
    throw new NotFoundError("Product not found")
  }
  const { location_ids, ...fields } = scopeForActor(actor, input, { creating: false })
  assertPackRules(fields, product)
  const patch = { ...fields }

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
  if (fields.barcode !== undefined) {
    await assertUnique(storeId, "barcode", fields.barcode, product.id)
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
  return publicProduct(await getProduct(storeId, product.id))
}

export async function deleteProduct(storeId, id) {
  const product = await getProduct(storeId, id)
  await product.update({ is_active: false, is_published: false, is_pos_visible: false })
  return publicProduct(product)
}

export async function listWeightProducts(storeId) {
  const rows = await Product.findAll({
    where: { store_id: storeId, is_weight_based: true },
    include: [categoryInclude],
    order: [["title", "ASC"]],
  })
  return rows.map((row) => publicProduct(row))
}

export async function patchWeight(storeId, id, fields) {
  const product = await getProduct(storeId, id)
  assertPackRules({ is_weight_based: fields.is_weight_based }, product)
  await product.update({ is_weight_based: fields.is_weight_based })
  return publicProduct(await getProduct(storeId, id))
}

export async function listExpiryProducts(storeId, locationId = null) {
  const store = await getStoreForManager(storeId)
  const rows = await ProductStock.findAll({
    where: {
      store_id: storeId,
      expiry_date: { [Op.ne]: null },
      ...(locationId ? { location_id: locationId } : {}),
    },
    include: [
      { model: Product, include: [categoryInclude] },
      { model: Location, attributes: ["id", "name", "location_id_int"] },
    ],
    order: [["expiry_date", "ASC"]],
  })
  return rows
    .filter((stock) => stock.Product)
    .map((stock) =>
      publicProduct(stock.Product, {
        stocks: [publicStock(stock, stock.Product)],
        store_id: stock.store_id,
        store_number: stock.store_id_int,
        location_id: stock.location_id,
        location_number: stock.location_id_int,
        expiry_date: stock.expiry_date,
        expiry_status: expiryStatus(
          stock.expiry_date,
          store.expiry_warning_days,
          store.expiry_critical_days
        ),
      })
    )
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
