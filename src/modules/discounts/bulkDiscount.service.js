import { Op } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { BulkDiscount, BulkDiscountTier } from "./bulkDiscount.model.js"
import { Product } from "../catalog/product.model.js"
import { resolveSellable } from "./discountTargets.js"
import { liveFlag, windowIsLive } from "./discountParse.js"
import { nextBulkNumber } from "../../shared/utils/counter.util.js"
import { AppError } from "../../shared/errors/AppError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

const tiersInclude = { model: BulkDiscountTier }

/** A bulk discount as the API returns it: product_id = the product row (the variant's own row for a variant). */
export function publicBulk(row) {
  const json = row.toJSON ? row.toJSON() : row
  return {
    id: json.id,
    store_id: json.store_id,
    store_number: json.store_id_int,
    bulk_number: json.bulk_number,
    name: json.name,
    product_id: json.product_id,
    sale_unit: json.sale_unit,
    tiers: (json.BulkDiscountTiers || [])
      .map((tier) => ({ min_qty: Number(tier.min_qty), discount_type: tier.discount_type, discount_value: Number(tier.discount_value) }))
      .sort((a, b) => a.min_qty - b.min_qty),
    start_at: json.start_at,
    end_at: json.end_at,
    is_active: Boolean(json.is_active),
    created_by: json.created_by,
    created_at: json.created_at,
    updated_at: json.updated_at,
  }
}

async function setTiers(bulkId, tiers, transaction) {
  await BulkDiscountTier.destroy({ where: { bulk_id: bulkId }, transaction })
  await BulkDiscountTier.bulkCreate(tiers.map((tier) => ({ ...tier, bulk_id: bulkId })), { transaction })
}

export async function listBulks(storeId, query = {}) {
  const where = { store_id: storeId }
  // active: true = the live ones, false = the ones that are not live, left out = every one.
  const live = liveFlag(query)
  if (live === true) where.is_active = true
  if (query.product_id) {
    const sellable = await resolveSellable(storeId, query.product_id, query.variant_id, { label: "product_id" })
    where.product_id = sellable.id
  }
  const rows = await BulkDiscount.findAll({ where, include: [tiersInclude], order: [["created_at", "DESC"]] })
  const views = rows.map(publicBulk)
  return live === undefined ? views : views.filter((view) => windowIsLive(view) === live)
}

export async function getBulk(storeId, id) {
  const row = await BulkDiscount.findOne({ where: { id, store_id: storeId }, include: [tiersInclude] })
  if (!row) throw new NotFoundError("Bulk discount not found")
  return row
}

export async function createBulk(store, input, actor) {
  const { staff_ref: _staff, product_ref, variant_ref, tiers, ...fields } = input
  const target = await resolveSellable(store.id, product_ref, variant_ref, { label: "product_id", saleUnit: fields.sale_unit })
  const taken = await BulkDiscount.findOne({ where: { store_id: store.id, product_id: target.id }, attributes: ["bulk_number"] })
  if (taken) throw new AppError(`${target.title} already has bulk discount ${taken.bulk_number}: update its tiers`, 400)
  const created = await sequelize.transaction(async (transaction) => {
    const row = await BulkDiscount.create(
      {
        ...fields,
        product_id: target.id,
        store_id: store.id,
        store_id_int: store.store_id_int,
        bulk_number: await nextBulkNumber(store.id, transaction),
        created_by: actor.id,
      },
      { transaction }
    )
    await setTiers(row.id, tiers, transaction)
    return row
  })
  return publicBulk(await getBulk(store.id, created.id))
}

export async function updateBulk(storeId, id, patch) {
  const row = await getBulk(storeId, id)
  const { tiers, ...fields } = patch
  if (fields.sale_unit === "pack") {
    const product = await Product.findByPk(row.product_id, { attributes: ["title", "is_pack_product"] })
    if (!product?.is_pack_product) throw new AppError(`${product?.title || "The product"} is not a pack product: sale_unit must be unit`, 400)
  }
  const start = fields.start_at !== undefined ? fields.start_at : row.start_at
  const end = fields.end_at !== undefined ? fields.end_at : row.end_at
  if (start && end && new Date(end) < new Date(start)) throw new AppError("end_at must be on or after start_at", 400)
  await sequelize.transaction(async (transaction) => {
    if (tiers) await setTiers(row.id, tiers, transaction)
    await row.update(fields, { transaction })
  })
  return publicBulk(await getBulk(storeId, id))
}

/** Soft delete: it leaves the list and the POS. */
export async function deleteBulk(storeId, id) {
  const row = await getBulk(storeId, id)
  const view = publicBulk(row)
  await row.destroy()
  const gone = await BulkDiscount.findOne({ where: { id: row.id }, paranoid: false, attributes: ["deleted_at"] })
  return { ...view, deleted_at: gone?.deleted_at || new Date() }
}

/** The live bulk discounts on any of these product rows (UUIDs: a product and / or its variants). */
export async function bulksForProducts(storeId, productRowIds) {
  if (!productRowIds.length) return []
  const rows = await BulkDiscount.findAll({
    where: { store_id: storeId, product_id: { [Op.in]: productRowIds }, is_active: true },
    include: [tiersInclude],
    order: [["bulk_number", "ASC"]],
  })
  return rows.map(publicBulk).filter((view) => windowIsLive(view))
}
