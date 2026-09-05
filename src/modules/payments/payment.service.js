import { Payment } from "./payment.model.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

export async function confirmPayment(storeId, id) {
  const where = { id }
  if (storeId) where.store_id = storeId
  const row = await Payment.findOne({ where })
  if (!row) throw new NotFoundError("Payment not found")
  if (row.status === "success") return row
  if (row.status === "failed") {
    throw new ConflictError("Failed payment cannot be confirmed")
  }
  await row.update({ status: "success", paid_at: new Date() })
  return row
}
