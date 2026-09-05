import { Op } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { Order } from "./order.model.js"
import { OrderItem } from "./orderItem.model.js"
import { Payment } from "../payments/payment.model.js"
import { Receipt } from "../payments/receipt.model.js"
import { Customer } from "../customers/customer.model.js"
import { CustomerCreditEntry } from "../customers/customerCreditEntry.model.js"
import { getStoreForManager } from "../stores/store.service.js"
import { getLocation } from "../locations/location.service.js"
import { getCustomer, recordLedgerEntry } from "../customers/customer.service.js"
import { createOrder as persistOrder, publicOrder } from "../commerce/createOrder.service.js"
import {
  cartItemsAsOrderLines,
  clearCart,
  loadCartWithItems,
} from "../carts/cart.service.js"
import { resolveCheckoutAddress } from "../addresses/address.service.js"
import { restockSaleStock } from "../commerce/stock.service.js"
import { money } from "../commerce/pricing.service.js"
import {
  applySessionSale,
} from "../pos/registerSession.service.js"
import { RegisterSession } from "../pos/registerSession.model.js"
import { requireApprovedAction } from "../pos/approval.service.js"
import { writeAudit } from "../../shared/utils/audit.util.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

const orderIncludes = [
  { model: OrderItem },
  { model: Payment },
]

function locationScope(actor, query = {}) {
  if (actor.role === "store_admin") {
    return query.location_id || query.locationId || null
  }
  if (actor.role === "customer") return null
  return actor.location_id
}

async function findOrder(storeId, id) {
  const row = await Order.findOne({
    where: { id, store_id: storeId },
    include: orderIncludes,
  })
  if (!row) throw new NotFoundError("Order not found")
  return row
}

function assertCanSee(actor, order) {
  if (actor.role === "store_admin") return
  if (actor.role === "customer") return
  if (order.location_id && actor.location_id && order.location_id !== actor.location_id) {
    throw new NotFoundError("Order not found")
  }
}

async function findCustomerForActor(actor) {
  return Customer.findOne({
    where: { store_id: actor.store_id, user_id: actor.id },
  })
}

async function placeWebCustomerOrder(actor, fields) {
  const { cart, items } = await loadCartWithItems(actor)
  const lines = cartItemsAsOrderLines(items)
  if (!lines.length) throw new AppError("Cart is empty", 400)

  const shipping_address = await resolveCheckoutAddress(actor, {
    addressId: fields.address_id,
    shippingAddress: fields.shipping_address,
  })

  const result = await persistOrder(actor, {
    ...fields,
    channel: "web",
    items: lines,
    coupon_code: fields.coupon_code || cart.coupon_code,
    shipping_address,
    is_custom: false,
    register_session_id: null,
    device_id: null,
  })

  if (!result.idempotent) await clearCart(actor)
  return result
}

export async function placeOrder(actor, fields) {
  if (actor.role === "customer" && fields.channel === "pos") {
    throw new ForbiddenError("Customers cannot place POS orders")
  }
  if (fields.channel === "web" && actor.role === "customer") {
    return placeWebCustomerOrder(actor, fields)
  }
  return persistOrder(actor, {
    ...fields,
    register_session_id:
      fields.channel === "web" ? null : fields.register_session_id,
    device_id: fields.channel === "web" ? null : fields.device_id,
  })
}

export async function listOrders(actor, query = {}, extraWhere = {}) {
  const where = { store_id: actor.store_id, ...extraWhere }
  if (actor.role === "customer") {
    const customer = await findCustomerForActor(actor)
    if (!customer) return []
    where.customer_id = customer.id
  }
  const locationId = locationScope(actor, query)
  if (locationId) where.location_id = locationId
  if (query.channel) where.channel = query.channel
  if (query.payment_method) where.payment_method = query.payment_method
  if (query.cashier_id) where.cashier_id = query.cashier_id
  if (query.from || query.to) {
    where.placed_at = {}
    if (query.from) where.placed_at[Op.gte] = new Date(query.from)
    if (query.to) where.placed_at[Op.lte] = new Date(query.to)
  }

  const rows = await Order.findAll({
    where,
    order: [["placed_at", "DESC"]],
  })
  return rows.map((row) => publicOrder(row))
}

export async function listCustomOrders(actor, query = {}) {
  return listOrders(actor, query, { is_custom: true })
}

export async function listCancelledOrders(actor, query = {}) {
  const rows = await listOrders(actor, query, {
    order_status: { [Op.in]: ["cancelled", "voided"] },
  })
  const lost_sales = money(
    rows.reduce((sum, row) => sum + Number(row.total_amount), 0)
  )
  return { orders: rows, lost_sales, count: rows.length }
}

export async function getOrderView(actor, id) {
  if (actor.role === "customer") {
    const customer = await Customer.findOne({
      where: { store_id: actor.store_id, user_id: actor.id },
    })
    if (!customer) throw new NotFoundError("Order not found")
    const row = await Order.findOne({
      where: { id, store_id: actor.store_id, customer_id: customer.id },
      include: orderIncludes,
    })
    if (!row) throw new NotFoundError("Order not found")
    return decorate(row)
  }

  const row = await findOrder(actor.store_id, id)
  assertCanSee(actor, row)
  return decorate(row)
}

function decorate(row) {
  return {
    order: publicOrder(row),
    items: row.OrderItems || [],
    payments: row.Payments || [],
  }
}

export async function listOrderPayments(actor, id) {
  const view = await getOrderView(actor, id)
  return view.payments
}

export async function addOrderPayment(actor, id, fields) {
  const order = await findOrder(actor.store_id, id)
  assertCanSee(actor, order)
  if (!["completed", "pending"].includes(order.order_status)) {
    throw new ConflictError("Cannot add a payment to this order")
  }

  const payment = await Payment.create({
    store_id: order.store_id,
    store_id_int: order.store_id_int,
    location_id: order.location_id,
    location_id_int: order.location_id_int,
    order_id: order.id,
    method: fields.method,
    amount: fields.amount,
    tax_amount: 0,
    currency: "PKR",
    status: "success",
    paid_at: new Date(),
  })

  const payments = await Payment.findAll({ where: { order_id: order.id } })
  const amount_paid = money(
    payments.reduce((sum, row) => sum + Number(row.amount), 0)
  )
  const methods = [...new Set(payments.map((row) => row.method))]
  await order.update({
    amount_paid,
    payment_method: methods.length > 1 ? "mixed" : methods[0],
    payment_status: amount_paid >= Number(order.total_amount) ? "paid" : "pending",
  })
  return payment
}

async function reverseCredit(order, actor, { transaction }) {
  const entries = await CustomerCreditEntry.findAll({
    where: { store_id: order.store_id, order_id: order.id, entry_type: "debit" },
    transaction,
  })
  if (!entries.length || !order.customer_id) return
  const customer = await getCustomer(order.store_id, order.customer_id)
  for (const entry of entries) {
    await recordLedgerEntry(
      customer,
      {
        entry_type: "credit",
        amount: Number(entry.amount),
        order_id: order.id,
        created_by: actor.id,
        note: `Reverse order #${order.order_number}`,
      },
      { transaction }
    )
  }
}

async function restockOrder(order, actor, { transaction }) {
  if (order.is_custom) return
  if (!order.location_id) return
  const store = await getStoreForManager(order.store_id)
  const location = await getLocation(store.id, order.location_id)
  const items = order.OrderItems?.length
    ? order.OrderItems
    : await OrderItem.findAll({ where: { order_id: order.id }, transaction })
  for (const item of items) {
    if (!item.product_id) continue
    await restockSaleStock(
      {
        store,
        location,
        productId: item.product_id,
        qty: item.quantity,
        staffId: actor.id,
        orderId: order.id,
        isCustom: false,
      },
      { transaction }
    )
  }
}

export async function voidOrder(actor, id, fields) {
  const store = await getStoreForManager(actor.store_id)
  const order = await findOrder(store.id, id)
  assertCanSee(actor, order)
  if (order.order_status !== "completed") {
    throw new ConflictError("Only a completed order can be voided")
  }
  await requireApprovedAction({
    store,
    actor,
    type: "void_order",
    orderId: order.id,
    approvalRequestId: fields.approval_request_id,
  })

  return sequelize.transaction(async (transaction) => {
    await restockOrder(order, actor, { transaction })
    await reverseCredit(order, actor, { transaction })
    if (order.register_session_id) {
      const session = await RegisterSession.findByPk(order.register_session_id, {
        transaction,
      })
      if (session && session.status === "clock_in") {
        await applySessionSale(
          session,
          {
            payments: order.Payments,
            total: order.total_amount,
            reverse: true,
          },
          { transaction }
        )
      }
    }
    await order.update(
      {
        order_status: "voided",
        payment_status: "refunded",
        void_reason: fields.reason,
        voided_by: actor.id,
      },
      { transaction }
    )
    await writeAudit({
      action: "void",
      entity_type: "orders",
      entity_id: order.id,
      store_id: store.id,
      store_id_int: store.store_id_int,
      location_id: order.location_id,
      location_id_int: order.location_id_int,
      user_id: actor.id,
      channel: order.channel,
      note: fields.reason,
    })
    return publicOrder(await findOrder(store.id, id))
  })
}

export async function cancelOrder(actor, id, fields) {
  const store = await getStoreForManager(actor.store_id)
  const order = await findOrder(store.id, id)
  assertCanSee(actor, order)
  if (order.order_status === "completed") {
    throw new ConflictError("Use void for a completed sale")
  }
  if (!["pending"].includes(order.order_status)) {
    throw new ConflictError("Only a pending order can be cancelled")
  }
  await requireApprovedAction({
    store,
    actor,
    type: "cancel_order",
    orderId: order.id,
    approvalRequestId: fields.approval_request_id,
  })

  await order.update({
    order_status: "cancelled",
    cancel_reason: fields.reason,
    cancelled_by: actor.id,
  })
  await writeAudit({
    action: "cancel",
    entity_type: "orders",
    entity_id: order.id,
    store_id: store.id,
    store_id_int: store.store_id_int,
    location_id: order.location_id,
    user_id: actor.id,
    channel: order.channel,
    note: fields.reason,
  })
  return publicOrder(await findOrder(store.id, id))
}

export async function getOrderReceipt(actor, id) {
  const view = await getOrderView(actor, id)
  const receipt = await Receipt.findOne({
    where: { store_id: actor.store_id, order_id: id },
  })
  if (!receipt) throw new NotFoundError("Receipt not found")
  return { receipt, ...view }
}
