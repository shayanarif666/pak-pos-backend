import { Payment } from "./payment.model.js"
import { Order } from "../orders/order.model.js"
import { sequelize } from "../../db/sequelize.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

export async function confirmPayment(storeId, id) {
  const where = { id }
  if (storeId) where.store_id = storeId
  return sequelize.transaction(async (transaction) => {
    const row = await Payment.findOne({ where, transaction, lock: transaction.LOCK.UPDATE })
    if (!row) throw new NotFoundError("Payment not found")
    if (row.status === "success") return row
    if (row.status === "failed") {
      throw new ConflictError("Failed payment cannot be confirmed")
    }
    await row.update({ status: "success", paid_at: new Date() }, { transaction })

    // Web orders (COD / wallet) stay pending until every payment row is collected.
    const pending = await Payment.count({
      where: { order_id: row.order_id, status: "initiated" },
      transaction,
    })
    if (!pending) {
      const order = await Order.findByPk(row.order_id, { transaction })
      if (order && order.payment_status === "pending") {
        await order.update(
          {
            payment_status: "paid",
            order_status: order.order_status === "pending" ? "completed" : order.order_status,
          },
          { transaction }
        )
      }
    }
    return row
  })
}
