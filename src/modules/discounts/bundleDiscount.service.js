import { Op } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { BundleDiscount } from "./bundleDiscount.model.js"
import { BundleDiscountProduct } from "./bundleDiscountProduct.model.js"
import { assertDiscountFits } from "./discountParse.js"
import { Product } from "../catalog/product.model.js"
import { nextBundleNumber } from "../../shared/utils/counter.util.js"
import { AppError } from "../../shared/errors/AppError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

const productsInclude = { model: BundleDiscountProduct }

export function publicBundle(row) {
  const json = row.toJSON ? row.toJSON() : row
  return {
    id: json.id,
    store_id: json.store_id,
    store_number: json.store_id_int,
    bundle_number: json.bundle_number,
    name: json.name,
    discount_type: json.discount_type,
    discount_value: Number(json.discount_value),
    product_ids: (json.BundleDiscountProducts || []).map((link) => link.product_id),
    start_at: json.start_at,
    end_at: json.end_at,
    is_active: Boolean(json.is_active),
    created_by: json.created_by,
    created_at: json.created_at,
    updated_at: json.updated_at,
  }
}

/** The live window: active, started and not ended. */
export function bundleIsLive(view, now = new Date()) {
  if (!view.is_active) return false
  if (view.start_at && now < new Date(view.start_at)) return false
  if (view.end_at && now > new Date(view.end_at)) return false
  return true
}

/** Refs (product number or UUID) as the UUIDs of this store's pack products. */
async function resolvePackProducts(storeId, refs, transaction) {
  const ids = []
  for (const value of refs) {
    const where = { store_id: storeId, parent_product_id: null }
    if (/^\d+$/.test(value)) where.product_number = Number(value)
    else where.id = value
    const product = await Product.findOne({ where, attributes: ["id", "title", "is_pack_product"], transaction })
    if (!product) throw new NotFoundError(`Product ${value} not found`)
    if (!product.is_pack_product) {
      throw new AppError(`${product.title} is not a pack product: a bundle discount is on a whole pack / carton`, 400)
    }
    ids.push(product.id)
  }
  return ids
}

async function setProducts(bundleId, productIds, transaction) {
  await BundleDiscountProduct.destroy({ where: { bundle_id: bundleId }, transaction })
  await BundleDiscountProduct.bulkCreate(
    productIds.map((product_id) => ({ bundle_id: bundleId, product_id })),
    { transaction }
  )
}

export async function listBundles(storeId, query = {}) {
  const where = { store_id: storeId }
  const liveOnly = query.active === "1" || query.pos === "1"
  if (liveOnly) where.is_active = true
  const rows = await BundleDiscount.findAll({ where, include: [productsInclude], order: [["created_at", "DESC"]] })
  const views = rows.map(publicBundle)
  return liveOnly ? views.filter((view) => bundleIsLive(view)) : views
}

export async function getBundle(storeId, id) {
  const row = await BundleDiscount.findOne({ where: { id, store_id: storeId }, include: [productsInclude] })
  if (!row) throw new NotFoundError("Bundle discount not found")
  return row
}

export async function createBundle(store, input, actor) {
  const { staff_ref: _staff, products, ...fields } = input
  const created = await sequelize.transaction(async (transaction) => {
    const productIds = await resolvePackProducts(store.id, products, transaction)
    const row = await BundleDiscount.create(
      {
        ...fields,
        store_id: store.id,
        store_id_int: store.store_id_int,
        bundle_number: await nextBundleNumber(store.id, transaction),
        created_by: actor.id,
      },
      { transaction }
    )
    await setProducts(row.id, productIds, transaction)
    return row
  })
  return publicBundle(await getBundle(store.id, created.id))
}

export async function updateBundle(storeId, id, patch) {
  const row = await getBundle(storeId, id)
  const { products, ...fields } = patch
  assertDiscountFits(fields.discount_type ?? row.discount_type, fields.discount_value ?? row.discount_value)
  const start = fields.start_at !== undefined ? fields.start_at : row.start_at
  const end = fields.end_at !== undefined ? fields.end_at : row.end_at
  if (start && end && new Date(end) < new Date(start)) throw new AppError("end_at must be on or after start_at", 400)
  await sequelize.transaction(async (transaction) => {
    if (products) await setProducts(row.id, await resolvePackProducts(storeId, products, transaction), transaction)
    await row.update(fields, { transaction })
  })
  return publicBundle(await getBundle(storeId, id))
}

/** Soft delete: it leaves the list and the POS. */
export async function deleteBundle(storeId, id) {
  const row = await getBundle(storeId, id)
  const view = publicBundle(row)
  await row.destroy()
  const gone = await BundleDiscount.findOne({ where: { id: row.id }, paranoid: false, attributes: ["deleted_at"] })
  return { ...view, deleted_at: gone?.deleted_at || new Date() }
}

/** The live bundles that cover any of these products (their UUIDs). */
export async function bundlesForProducts(storeId, productIds) {
  if (!productIds.length) return []
  const links = await BundleDiscountProduct.findAll({
    where: { product_id: { [Op.in]: productIds } },
    attributes: ["bundle_id"],
  })
  const bundleIds = [...new Set(links.map((link) => link.bundle_id))]
  if (!bundleIds.length) return []
  const rows = await BundleDiscount.findAll({
    where: { store_id: storeId, id: { [Op.in]: bundleIds }, is_active: true },
    include: [productsInclude],
    order: [["bundle_number", "ASC"]],
  })
  return rows.map(publicBundle).filter((view) => bundleIsLive(view))
}
