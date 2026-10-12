import { sequelize } from "../../db/sequelize.js"
import { Counter } from "./counter.model.js"

export async function getNextSequence(name, transaction) {
  const t = transaction ?? (await sequelize.transaction())
  const ownsTransaction = !transaction

  try {
    await Counter.findOrCreate({
      where: { name },
      defaults: { name, seq: 0 },
      transaction: t,
    })

    await sequelize.query(
      "UPDATE counters SET seq = LAST_INSERT_ID(seq + 1) WHERE name = ?",
      { replacements: [name], transaction: t }
    )

    const [rows] = await sequelize.query("SELECT LAST_INSERT_ID() AS seq", {
      transaction: t,
    })

    if (ownsTransaction) await t.commit()
    return Number(rows[0].seq)
  } catch (err) {
    if (ownsTransaction) await t.rollback()
    throw err
  }
}

export async function ensureSequenceAtLeast(name, min, transaction) {
  await Counter.findOrCreate({
    where: { name },
    defaults: { name, seq: min },
    transaction,
  })
  await sequelize.query(
    "UPDATE counters SET seq = GREATEST(seq, ?) WHERE name = ?",
    { replacements: [min, name], transaction }
  )
}

export const nextStoreID = (transaction) => getNextSequence("store", transaction)

export const nextLocationID = (storeId, transaction) =>
  getNextSequence(`location:${storeId}`, transaction)

export const nextOrderNumber = (storeId, transaction) =>
  getNextSequence(`order:${storeId}`, transaction)

export const nextReceiptNumber = (storeId, transaction) =>
  getNextSequence(`receipt:${storeId}`, transaction)

export const nextUserNumber = (storeId, transaction) =>
  getNextSequence(`user:${storeId}`, transaction)

export const nextDeviceNumber = (storeId, transaction) =>
  getNextSequence(`device:${storeId}`, transaction)

export const nextSessionNumber = (storeId, transaction) =>
  getNextSequence(`register_session:${storeId}`, transaction)

export const nextCategoryNumber = (storeId, transaction) =>
  getNextSequence(`category:${storeId}`, transaction)

export const nextProductNumber = (storeId, transaction) =>
  getNextSequence(`product:${storeId}`, transaction)

export const nextOfferNumber = (storeId, transaction) =>
  getNextSequence(`offer:${storeId}`, transaction)

export const nextSupplierNumber = (storeId, transaction) =>
  getNextSequence(`supplier:${storeId}`, transaction)

export const nextSupplierLedgerNumber = (supplierId, transaction) =>
  getNextSequence(`supplier_ledger:${supplierId}`, transaction)

export const nextStockMovementNumber = (storeId, transaction) =>
  getNextSequence(`stock_movement:${storeId}`, transaction)

export const nextStockTransferNumber = (storeId, transaction) =>
  getNextSequence(`stock_transfer:${storeId}`, transaction)

export const nextCustomerNumber = (storeId, transaction) =>
  getNextSequence(`customer:${storeId}`, transaction)

export const nextOrderRefundNumber = (storeId, transaction) =>
  getNextSequence(`order_refund:${storeId}`, transaction)

export const nextOrderRefundItemNumber = (refundId, transaction) =>
  getNextSequence(`order_refund_item:${refundId}`, transaction)
