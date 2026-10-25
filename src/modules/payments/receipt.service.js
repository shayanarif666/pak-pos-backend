import { Receipt } from "./receipt.model.js"
import { Order } from "../orders/order.model.js"
import { OrderItem } from "../orders/orderItem.model.js"
import { Payment } from "./payment.model.js"
import { publicOrder } from "../commerce/createOrder.service.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { AppError } from "../../shared/errors/AppError.js"

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

/**
 * The sale receipt of an order (order number or UUID) — the receipt written when the sale was
 * placed, not a later refund receipt.
 */
export async function getOrderSaleReceipt(actor, orderRef) {
  const ref = String(orderRef ?? "").trim()
  if (!ref) throw new AppError("order_id is required", 400)
  const where = /^\d+$/.test(ref)
    ? { store_id: actor.store_id, order_number: Number(ref) }
    : { store_id: actor.store_id, id: ref }
  const order = await Order.findOne({ where, attributes: ["id"] })
  if (!order) throw new NotFoundError("Order not found")
  const receipt = await Receipt.findOne({
    where: { order_id: order.id, store_id: actor.store_id },
    order: [["issued_at", "ASC"]],
  })
  if (!receipt) throw new NotFoundError("Receipt not found")
  return receipt
}
