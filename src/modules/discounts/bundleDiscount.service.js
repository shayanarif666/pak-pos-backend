import { Op } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { BundleDiscount } from "./bundleDiscount.model.js"
import { BundleDiscountProduct } from "./bundleDiscountProduct.model.js"
import { BundleDiscountReward } from "./bundleDiscountReward.model.js"
import { windowIsLive } from "./discountParse.js"
import { resolveSellable } from "./discountTargets.js"
import { nextBundleNumber } from "../../shared/utils/counter.util.js"
import { AppError } from "../../shared/errors/AppError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

const childrenInclude = [{ model: BundleDiscountProduct }, { model: BundleDiscountReward }]

const lineView = (row) => ({ product_id: row.product_id, qty: Number(row.qty), sale_unit: row.sale_unit })

/**
 * A bundle as the API returns it: components (what has to be bought together) and the reward — free_item
 * (rewards: what comes free) or a percentage / fixed discount (discount_type, discount_value).
 * product_id of a line = the product row (the variant's own row for a variant).
 */
export function publicBundle(row) {
  const json = row.toJSON ? row.toJSON() : row
  return {
    id: json.id,
    store_id: json.store_id,
    store_number: json.store_id_int,
    bundle_number: json.bundle_number,
    name: json.name,
    components: (json.BundleDiscountProducts || []).map(lineView),
    reward_type: json.reward_type,
    discount_type: json.discount_type || null,
    discount_value: json.discount_value == null ? null : Number(json.discount_value),
    rewards: (json.BundleDiscountRewards || []).map(lineView),
    start_at: json.start_at,
    end_at: json.end_at,
    is_active: Boolean(json.is_active),
    created_by: json.created_by,
    created_at: json.created_at,
    updated_at: json.updated_at,
  }
}

/** The live window: active, started and not ended. */
export const bundleIsLive = windowIsLive

/** Lines (components or free items) as rows: every product / variant must exist, a pack unit needs a pack product. */
async function resolveLines(storeId, lines, label) {
  const out = []
  const seen = new Set()
  for (const [index, line] of lines.entries()) {
    const at = `${label}[${index}]`
    // A plain number / UUID is one pack of a pack product, else one unit (older clients).
    const preview = await resolveSellable(storeId, line.product_ref, line.variant_ref, { label: at, needVariant: true })
    const sale_unit = line.sale_unit ?? (line.plain && preview.is_pack_product ? "pack" : "unit")
    if (sale_unit === "pack" && !preview.is_pack_product) {
      throw new AppError(`${at}: ${preview.title} is not a pack product: sale_unit must be unit`, 400)
    }
    if (seen.has(preview.id)) throw new AppError(`${at}: ${preview.title} is listed twice: raise its qty`, 400)
    seen.add(preview.id)
    out.push({ product_id: preview.id, qty: line.qty, sale_unit })
  }
  return out
}

async function setLines(model, bundleId, rows, transaction) {
  await model.destroy({ where: { bundle_id: bundleId }, transaction })
  if (rows.length) await model.bulkCreate(rows.map((row) => ({ ...row, bundle_id: bundleId })), { transaction })
}

export async function listBundles(storeId, query = {}) {
  const where = { store_id: storeId }
  const liveOnly = query.active === "1" || query.pos === "1"
  if (liveOnly) where.is_active = true
  const rows = await BundleDiscount.findAll({ where, include: childrenInclude, order: [["created_at", "DESC"]] })
  const views = rows.map(publicBundle)
  return liveOnly ? views.filter((view) => bundleIsLive(view)) : views
}

export async function getBundle(storeId, id) {
  const row = await BundleDiscount.findOne({ where: { id, store_id: storeId }, include: childrenInclude })
  if (!row) throw new NotFoundError("Bundle discount not found")
  return row
}

export async function createBundle(store, input, actor) {
  const { staff_ref: _staff, products, rewards, ...fields } = input
  const created = await sequelize.transaction(async (transaction) => {
    const components = await resolveLines(store.id, products, "products")
    const free = await resolveLines(store.id, rewards, "reward.items")
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
    await setLines(BundleDiscountProduct, row.id, components, transaction)
    await setLines(BundleDiscountReward, row.id, free, transaction)
    return row
  })
  return publicBundle(await getBundle(store.id, created.id))
}

export async function updateBundle(storeId, id, patch) {
  const row = await getBundle(storeId, id)
  const { products, rewards, ...fields } = patch
  const start = fields.start_at !== undefined ? fields.start_at : row.start_at
  const end = fields.end_at !== undefined ? fields.end_at : row.end_at
  if (start && end && new Date(end) < new Date(start)) throw new AppError("end_at must be on or after start_at", 400)
  await sequelize.transaction(async (transaction) => {
    if (products) await setLines(BundleDiscountProduct, row.id, await resolveLines(storeId, products, "products"), transaction)
    // A new reward replaces the old one whole (a free-item bundle can become a percentage one).
    if (rewards) await setLines(BundleDiscountReward, row.id, await resolveLines(storeId, rewards, "reward.items"), transaction)
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

/** The live bundles with a component among these product rows (UUIDs: a product and / or its variants). */
export async function bundlesForProducts(storeId, productRowIds) {
  if (!productRowIds.length) return []
  const links = await BundleDiscountProduct.findAll({
    where: { product_id: { [Op.in]: productRowIds } },
    attributes: ["bundle_id"],
  })
  const bundleIds = [...new Set(links.map((link) => link.bundle_id))]
  if (!bundleIds.length) return []
  const rows = await BundleDiscount.findAll({
    where: { store_id: storeId, id: { [Op.in]: bundleIds }, is_active: true },
    include: childrenInclude,
    order: [["bundle_number", "ASC"]],
  })
  return rows.map(publicBundle).filter((view) => bundleIsLive(view))
}
