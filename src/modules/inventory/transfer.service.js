import { sequelize } from "../../db/sequelize.js"
import { StockTransfer } from "./stockTransfer.model.js"
import { ProductStock } from "../catalog/productStock.model.js"
import { getProduct } from "../catalog/product.service.js"
import {
  applyStockDelta,
  loadLocation,
} from "../catalog/productStock.service.js"
import { getStoreForManager } from "../stores/store.service.js"
import { assertPlan } from "../../shared/utils/plan.util.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

async function assertMultiBranch(store) {
  await assertPlan(store, "multi_branch_enabled")
}

export async function listTransfers(storeId) {
  const store = await getStoreForManager(storeId)
  await assertMultiBranch(store)
  return StockTransfer.findAll({
    where: { store_id: storeId },
    order: [["created_at", "DESC"]],
  })
}

export async function createTransfer(storeId, fields, actor) {
  const store = await getStoreForManager(storeId)
  await assertMultiBranch(store)
  await getProduct(storeId, fields.product_id)
  const from = await loadLocation(storeId, fields.from_location_id)
  const to = await loadLocation(storeId, fields.to_location_id)

  return StockTransfer.create({
    store_id: storeId,
    from_location_id: from.id,
    to_location_id: to.id,
    product_id: fields.product_id,
    qty: fields.qty,
    note: fields.note,
    status: "pending",
    created_by: actor.id,
  })
}

async function getTransfer(storeId, id) {
  const row = await StockTransfer.findOne({ where: { id, store_id: storeId } })
  if (!row) throw new NotFoundError("Transfer not found")
  return row
}

export async function completeTransfer(storeId, id, actor) {
  const store = await getStoreForManager(storeId)
  await assertMultiBranch(store)
  const row = await getTransfer(storeId, id)
  if (row.status !== "pending") {
    throw new ConflictError("Only a pending transfer can be completed")
  }

  const from = await loadLocation(storeId, row.from_location_id)
  const to = await loadLocation(storeId, row.to_location_id)
  const qty = Number(row.qty)
  const source = await ProductStock.findOne({
    where: { location_id: from.id, product_id: row.product_id },
  })
  const available = source ? Number(source.qty) : 0
  if (available < qty) {
    throw new ConflictError("Insufficient stock at source location")
  }

  return sequelize.transaction(async (transaction) => {
    await applyStockDelta(
      {
        storeId,
        storeIdInt: store.store_id_int,
        location: from,
        productId: row.product_id,
        delta: -qty,
        movement_type: "transfer_out",
        reason: "transfer",
        reason_note: row.note,
        staff_id: actor.id,
      },
      { transaction }
    )
    await applyStockDelta(
      {
        storeId,
        storeIdInt: store.store_id_int,
        location: to,
        productId: row.product_id,
        delta: qty,
        movement_type: "transfer_in",
        reason: "transfer",
        reason_note: row.note,
        staff_id: actor.id,
      },
      { transaction }
    )
    await row.update({ status: "completed" }, { transaction })
    return row
  })
}

export async function cancelTransfer(storeId, id) {
  const store = await getStoreForManager(storeId)
  await assertMultiBranch(store)
  const row = await getTransfer(storeId, id)
  if (row.status !== "pending") {
    throw new ConflictError("Only a pending transfer can be cancelled")
  }
  await row.update({ status: "cancelled" })
  return row
}
