import { Op, UniqueConstraintError } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { Product } from "./product.model.js"
import { Category } from "./category.model.js"
import { ProductStock } from "./productStock.model.js"
import { ProductBulkTier } from "./productBulkTier.model.js"
import { ensureUniqueSlug } from "../../shared/utils/slugify.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { AppError } from "../../shared/errors/AppError.js"
import { findLiveStoreBySlug, getStoreForManager } from "../stores/store.service.js"

const categoryInclude = {
  model: Category,
  attributes: [
    "id",
    "name",
    "slug",
    "web_visible",
    "is_active",
    "tax_type",
    "tax_value",
    "discount_type",
    "discount_value",
  ],
}

function assertPackRules(fields, current = {}) {
  const is_pack = fields.is_pack_product ?? current.is_pack_product
  const is_weight = fields.is_weight_based ?? current.is_weight_based
  const pack_size = fields.pack_size !== undefined ? fields.pack_size : current.pack_size

  if (is_pack && is_weight) {
    throw new AppError("A product cannot be both pack-based and weight-based", 400)
  }
  if (is_pack && (!pack_size || pack_size < 2)) {
    throw new AppError("pack_size must be >= 2 for pack products", 400)
  }
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
  return {
    id: row.id,
    location_id: row.location_id,
    location_number: row.location_id_int,
    product_id: row.product_id,
    qty,
    low_stock_threshold: row.low_stock_threshold,
    effective_threshold: threshold == null ? null : Number(threshold),
    is_low:
      threshold == null ? false : qty <= Number(threshold),
    number_of_packs: numberOfPacks(qty, product?.pack_size),
  }
}

function publicProduct(product, extras = {}) {
  const json = product.toJSON ? product.toJSON() : product
  return {
    id: json.id,
    store_id: json.store_id,
    category_id: json.category_id,
    category: json.Category
      ? {
          id: json.Category.id,
          name: json.Category.name,
          slug: json.Category.slug,
          tax_type: json.Category.tax_type || null,
          tax_value: json.Category.tax_value == null ? null : Number(json.Category.tax_value),
          discount_type: json.Category.discount_type || null,
          discount_value:
            json.Category.discount_value == null ? null : Number(json.Category.discount_value),
        }
      : null,
    title: json.title,
    slug: json.slug,
    sku: json.sku,
    barcode: json.barcode,
    image_url: json.image_url,
    description: json.description,
    unit: json.unit,
    cost_price: json.cost_price,
    selling_price: json.selling_price,
    has_product_discount: json.has_product_discount,
    discount_type: json.discount_type,
    discount_value: json.discount_value,
    tax_type: json.tax_type,
    tax_value: json.tax_value,
    is_pack_product: json.is_pack_product,
    pack_size: json.pack_size,
    sell_loose: json.sell_loose,
    is_weight_based: json.is_weight_based,
    has_bulk_discount: json.has_bulk_discount,
    expiry_date: json.expiry_date,
    low_stock_threshold: json.low_stock_threshold,
    is_published: json.is_published,
    pos_visible: json.pos_visible,
    web_visible: json.web_visible,
    is_active: json.is_active,
    created_at: json.created_at,
    updated_at: json.updated_at,
    ...extras,
  }
}

function publicWebProduct(product, extras = {}) {
  const row = publicProduct(product, extras)
  delete row.cost_price
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

export async function getProduct(storeId, id) {
  const product = await Product.findOne({
    where: { id, store_id: storeId },
    include: [categoryInclude],
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

  const rows = await ProductStock.findAll({ where })
  const byProduct = new Map()
  for (const row of rows) {
    const list = byProduct.get(row.product_id) || []
    list.push(row)
    byProduct.set(row.product_id, list)
  }

  return products.map((product) => {
    const stocks = (byProduct.get(product.id) || []).map((row) =>
      publicStock(row, product)
    )
    return publicProduct(product, { stocks })
  })
}

export async function listProducts(actor, query = {}) {
  const where = { store_id: actor.store_id }
  if (query.categoryId || query.category_id) {
    where.category_id = query.categoryId || query.category_id
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
    include: [categoryInclude],
    order: [["created_at", "DESC"]],
  })
  return attachStocks(products, actor, query.locationId || query.location_id)
}

export async function getProductView(actor, id, query = {}) {
  const product = await getProduct(actor.store_id, id)
  const [view] = await attachStocks(
    [product],
    actor,
    query.locationId || query.location_id
  )
  return view
}

export async function createProduct(store, fields) {
  assertPackRules(fields)
  const slug = await ensureUniqueSlug(fields.title, async (candidate) => {
    const existing = await Product.findOne({
      where: { store_id: store.id, slug: candidate },
    })
    return Boolean(existing)
  })
  if (!slug) throw new AppError("title must contain letters or numbers for a slug", 400)

  await resolveCategory(store.id, fields.category_id)
  await assertUnique(store.id, "sku", fields.sku)
  await assertUnique(store.id, "barcode", fields.barcode)

  try {
    const created = await Product.create({
      store_id: store.id,
      store_id_int: store.store_id_int,
      category_id: fields.category_id,
      title: fields.title,
      slug,
      sku: fields.sku,
      barcode: fields.barcode,
      image_url: fields.image_url,
      description: fields.description,
      unit: fields.unit,
      cost_price: fields.cost_price,
      selling_price: fields.selling_price,
      has_product_discount: fields.has_product_discount,
      discount_type: fields.discount_type,
      discount_value: fields.discount_value,
      tax_type: fields.tax_type,
      tax_value: fields.tax_value,
      is_pack_product: fields.is_pack_product,
      pack_size: fields.is_pack_product ? fields.pack_size : null,
      sell_loose: fields.sell_loose,
      is_weight_based: fields.is_weight_based,
      has_bulk_discount: fields.has_bulk_discount,
      expiry_date: fields.expiry_date,
      low_stock_threshold: fields.low_stock_threshold,
      is_published: fields.is_published,
      pos_visible: fields.pos_visible,
      web_visible: fields.web_visible,
      is_active: fields.is_active,
    })
    return publicProduct(await getProduct(store.id, created.id), { stocks: [] })
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new ConflictError("Product slug, SKU, or barcode already exists")
    }
    throw err
  }
}

export async function updateProduct(storeId, id, fields) {
  const product = await getProduct(storeId, id)
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
  }
  if (fields.sku !== undefined) await assertUnique(storeId, "sku", fields.sku, product.id)
  if (fields.barcode !== undefined) {
    await assertUnique(storeId, "barcode", fields.barcode, product.id)
  }
  if (fields.category_id !== undefined) {
    await resolveCategory(storeId, fields.category_id)
  }
  if (fields.is_pack_product === false) patch.pack_size = null

  try {
    await product.update(patch)
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
  await product.update({ is_active: false, is_published: false, pos_visible: false })
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

export async function listExpiryProducts(storeId) {
  const store = await getStoreForManager(storeId)
  const rows = await Product.findAll({
    where: {
      store_id: storeId,
      expiry_date: { [Op.ne]: null },
    },
    include: [categoryInclude],
    order: [["expiry_date", "ASC"]],
  })
  return rows.map((row) =>
    publicProduct(row, {
      expiry_status: expiryStatus(
        row.expiry_date,
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
  where: { web_visible: true, is_active: true },
  required: true,
}

export async function listPublicProducts(slug, { categoryId } = {}) {
  const store = await requireLiveStore(slug)
  const where = {
    store_id: store.id,
    is_published: true,
    web_visible: true,
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
      web_visible: true,
      is_active: true,
    },
    include: [publicCategoryInclude],
  })
  if (!product) throw new NotFoundError("Product not found")
  return publicWebProduct(product)
}

export { publicProduct, publicStock, numberOfPacks }
