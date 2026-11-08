import { OrderDiscount } from "./orderDiscount.model.js"
import { assertDiscountFits } from "./discountParse.js"
import { nextOrderDiscountNumber } from "../../shared/utils/counter.util.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { sequelize } from "../../db/sequelize.js"

export function publicOrderDiscount(row) {
  const json = row.toJSON ? row.toJSON() : row
  return {
    id: json.id,
    store_id: json.store_id,
    store_number: json.store_id_int,
    discount_number: json.discount_number,
    name: json.name,
    discount_type: json.discount_type,
    discount_value: Number(json.discount_value),
    apply_to_all_orders: Boolean(json.apply_to_all_orders),
    is_active: Boolean(json.is_active),
    created_by: json.created_by,
    created_at: json.created_at,
    updated_at: json.updated_at,
  }
}

export async function listOrderDiscounts(storeId, query = {}) {
  const where = { store_id: storeId }
  if (query.active === "1" || query.pos === "1") where.is_active = true
  const rows = await OrderDiscount.findAll({ where, order: [["created_at", "DESC"]] })
  return rows.map(publicOrderDiscount)
}

export async function getOrderDiscount(storeId, id) {
  const row = await OrderDiscount.findOne({ where: { id, store_id: storeId } })
  if (!row) throw new NotFoundError("Discount not found")
  return row
}

export async function createOrderDiscount(store, input, actor) {
  const { staff_ref: _staff, ...fields } = input
  const row = await sequelize.transaction(async (transaction) =>
    OrderDiscount.create(
      {
        ...fields,
        store_id: store.id,
        store_id_int: store.store_id_int,
        discount_number: await nextOrderDiscountNumber(store.id, transaction),
        created_by: actor.id,
      },
      { transaction }
    )
  )
  return publicOrderDiscount(row)
}

export async function updateOrderDiscount(storeId, id, patch) {
  const row = await getOrderDiscount(storeId, id)
  assertDiscountFits(patch.discount_type ?? row.discount_type, patch.discount_value ?? row.discount_value)
  await row.update(patch)
  return publicOrderDiscount(row)
}

/** Soft delete: it leaves the list and the POS; sales that used it keep their figures. */
export async function deleteOrderDiscount(storeId, id) {
  const row = await getOrderDiscount(storeId, id)
  const view = publicOrderDiscount(row)
  await row.destroy()
  const gone = await OrderDiscount.findOne({ where: { id: row.id }, paranoid: false, attributes: ["deleted_at"] })
  return { ...view, deleted_at: gone?.deleted_at || new Date() }
}

/** The active discount that goes on every order (the newest one when several are set). */
export async function autoOrderDiscount(storeId) {
  const row = await OrderDiscount.findOne({
    where: { store_id: storeId, is_active: true, apply_to_all_orders: true },
    order: [["created_at", "DESC"]],
  })
  return row ? publicOrderDiscount(row) : null
}
