import { Receipt } from "./receipt.model.js"
import { Order } from "../orders/order.model.js"
import { OrderItem } from "../orders/orderItem.model.js"
import { Payment } from "./payment.model.js"
import { publicOrder } from "../commerce/createOrder.service.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

export async function getReceipt(actor, id) {
  const where = { id, store_id: actor.store_id }
  if (actor.role !== "store_admin" && actor.location_id) {
    where.location_id = actor.location_id
  }
  const receipt = await Receipt.findOne({ where })
  if (!receipt) throw new NotFoundError("Receipt not found")

  const order = await Order.findOne({
    where: { id: receipt.order_id, store_id: actor.store_id },
    include: [{ model: OrderItem }, { model: Payment }],
  })
  if (!order) throw new NotFoundError("Order not found")

  return {
    receipt,
    order: publicOrder(order),
    items: order.OrderItems || [],
    payments: order.Payments || [],
  }
}
