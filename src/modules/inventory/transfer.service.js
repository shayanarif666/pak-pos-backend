import { sequelize } from "../../db/sequelize.js"
import { StockTransfer } from "./stockTransfer.model.js"
import { ProductStock } from "../catalog/productStock.model.js"
import { getProduct, getProductByNumber } from "../catalog/product.service.js"
import {
  applyStockDelta,
  loadLocation,
} from "../catalog/productStock.service.js"
import { getStoreForManager } from "../stores/store.service.js"
import { assertPlan } from "../../shared/utils/plan.util.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { nextStockTransferNumber } from "../../shared/utils/counter.util.js"

async function assertMultiBranch(store) {
  await assertPlan(store, "multi_branch_enabled")
}

export async function listTransfers(storeId) {
  const store = await getStoreForManager(storeId)
  // await assertMultiBranch(store)
  return StockTransfer.findAll({
    where: { store_id: storeId },
    order: [["created_at", "DESC"]],
  })
}

export async function createTransfer(storeId, fields, actor) {
  const store = await getStoreForManager(storeId)
  // await assertMultiBranch(store)
  // product_id / location ids: short numbers (as the POS sends them) or UUIDs.
  const product = /^\d+$/.test(String(fields.product_id))
    ? await getProductByNumber(storeId, Number(fields.product_id))
    : await getProduct(storeId, fields.product_id)
  const from = await loadLocation(storeId, fields.from_location_id)
  const to = await loadLocation(storeId, fields.to_location_id)
  if (from.id === to.id) throw new ConflictError("from and to locations must be different")

  // Reject up front instead of letting an impossible transfer sit on the way.
  const source = await ProductStock.findOne({
    where: { location_id: from.id, product_id: product.id },
  })
  const available = Number(source?.qty || 0)
  if (Number(fields.qty) > available) {
    throw new ConflictError(`Only ${available} available at the source location`)
  }

  return StockTransfer.create({
    store_id: storeId,
    transfer_number: await nextStockTransferNumber(storeId),
    from_location_id: from.id,
    to_location_id: to.id,
    product_id: product.id,
    qty: fields.qty,
    note: fields.note,
    // Sent from the source; stock moves when the destination completes it.
    status: "on_the_way",
    created_by: actor.id,
  })
}

async function getTransfer(storeId, id) {
  const row = await StockTransfer.findOne({ where: { id, store_id: storeId } })
  if (!row) throw new NotFoundError("Transfer not found")
  return row
}

export async function completeTransfer(storeId, id, actor) {
  return receiveTransfer(storeId, id, actor, {})
}

/**
 * The destination receives the transfer. received_qty = what actually arrived (default: all of
 * it); the source gives up the full qty that left, so a shortfall (broken / lost on the way)
 * shows as the difference and is noted on the transfer.
 */
export async function receiveTransfer(storeId, id, actor, { received_qty, note } = {}) {
  const store = await getStoreForManager(storeId)
  const row = await getTransfer(storeId, id)
  if (!["pending", "on_the_way"].includes(row.status)) {
    throw new ConflictError("Only a transfer on the way can be received")
  }

  const qty = Number(row.qty)
  const received = received_qty === undefined || received_qty === null ? qty : Number(received_qty)
  if (Number.isNaN(received) || received < 0 || received > qty) {
    throw new AppError(`received_qty must be between 0 and ${qty}`, 400)
  }
  const from = await loadLocation(storeId, row.from_location_id)
  const to = await loadLocation(storeId, row.to_location_id)
  const source = await ProductStock.findOne({
    where: { location_id: from.id, product_id: row.product_id },
  })
  const available = source ? Number(source.qty) : 0
  if (available < qty) {
    throw new ConflictError("Insufficient stock at source location")
  }
  const short = Number((qty - received).toFixed(4))
  const transferNote = [row.note, note, short > 0 ? `Received ${received} of ${qty} (${short} short)` : null]
    .filter(Boolean)
    .join(" — ")

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
        reason_note: transferNote || null,
        staff_id: actor.id,
      },
      { transaction }
    )
    if (received > 0) {
      await applyStockDelta(
        {
          storeId,
          storeIdInt: store.store_id_int,
          location: to,
          productId: row.product_id,
          delta: received,
          movement_type: "transfer_in",
          reason: "transfer",
          reason_note: transferNote || null,
          staff_id: actor.id,
        },
        { transaction }
      )
    }
    await row.update(
      { status: "completed", received_qty: received, note: transferNote || null },
      { transaction }
    )
    return row
  })
}

/** Edit a transfer still on the way: qty, destination or note. */
export async function updateTransfer(storeId, id, fields) {
  const row = await getTransfer(storeId, id)
  if (!["pending", "on_the_way"].includes(row.status)) {
    throw new ConflictError("Only a transfer on the way can be changed")
  }
  const patch = {}
  if (fields.to_location_id !== undefined) {
    const to = await loadLocation(storeId, fields.to_location_id)
    if (to.id === row.from_location_id) throw new ConflictError("from and to locations must be different")
    patch.to_location_id = to.id
  }
  if (fields.qty !== undefined) {
    const qty = Number(fields.qty)
    if (Number.isNaN(qty) || qty <= 0) throw new AppError("qty must be a number > 0", 400)
    const source = await ProductStock.findOne({
      where: { location_id: row.from_location_id, product_id: row.product_id },
    })
    const available = Number(source?.qty || 0)
    if (qty > available) throw new ConflictError(`Only ${available} available at the source location`)
    patch.qty = qty
  }
  if (fields.note !== undefined) patch.note = fields.note == null ? null : String(fields.note).trim()
  if (!Object.keys(patch).length) throw new AppError("Send qty, to_location_id or note", 400)
  await row.update(patch)
  return row
}

export async function cancelTransfer(storeId, id) {
  const store = await getStoreForManager(storeId)
  // await assertMultiBranch(store)
  const row = await getTransfer(storeId, id)
  if (!["pending", "on_the_way"].includes(row.status)) {
    throw new ConflictError("Only a transfer on the way can be cancelled")
  }
  await row.update({ status: "cancelled" })
  return row
}
