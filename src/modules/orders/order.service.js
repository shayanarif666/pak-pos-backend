import { Op } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { Order } from "./order.model.js"
import { OrderItem } from "./orderItem.model.js"
import { OrderRefund } from "./orderRefund.model.js"
import { OrderRefundItem } from "./orderRefundItem.model.js"
import { Payment } from "../payments/payment.model.js"
import { Receipt } from "../payments/receipt.model.js"
import { User } from "../auth/user.model.js"
import { Customer } from "../customers/customer.model.js"
import { CustomerCreditEntry } from "../customers/customerCreditEntry.model.js"
import { nextReceiptNumber } from "../../shared/utils/counter.util.js"
import { getStoreForManager } from "../stores/store.service.js"
import { getLocation } from "../locations/location.service.js"
import { getCustomer, recordLedgerEntry } from "../customers/customer.service.js"
import { createOrder as persistOrder, publicOrder, publicOrderItem } from "../commerce/createOrder.service.js"
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
  { model: User, as: "cashier", attributes: ["id", "name", "email", "phone", "role"] },
  { model: Customer, as: "customer", attributes: ["id", "name", "email", "phone"] },
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
    order_status: { [Op.in]: ["cancelled", "voided", "refunded"] },
  })
  const lost_sales = money(
    rows.reduce((sum, row) => sum + Number(row.total_amount), 0)
  )
  return { orders: rows, lost_sales, count: rows.length }
}

export async function listOrderRefunds(actor, query = {}) {
  const where = { store_id: actor.store_id }
  const locationId = locationScope(actor, query)
  if (locationId) where.location_id = locationId

  const rows = await OrderRefund.findAll({
    where,
    include: [
      { model: OrderRefundItem },
      { model: Order, attributes: ["id", "order_number", "order_status"] },
      { model: User, as: "cashier", attributes: ["id", "name", "role"] },
    ],
    order: [["created_at", "DESC"]],
  })

  return rows.map((row) => {
    const json = row.toJSON ? row.toJSON() : row
    const items = (row.OrderRefundItems || []).map((line) => {
      const item = line.toJSON ? line.toJSON() : line
      return {
        id: item.id,
        title: item.title,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        subtotal: Number(item.subtotal),
        tax_amount: Number(item.tax_amount),
      }
    })
    return {
      id: json.id,
      order_id: json.order_id,
      order_number: row.Order?.order_number,
      order_status: row.Order?.order_status,
      reason: json.reason,
      amount: Number(json.amount),
      tax_amount: Number(json.tax_amount),
      created_at: json.created_at,
      cashier: staffLite(row.cashier),
      items,
      item_title: items.map((item) => item.title).join(", "),
      quantity: items.reduce((sum, item) => sum + Number(item.quantity), 0),
    }
  })
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

function staffLite(user) {
  if (!user) return null
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
  }
}

function customerLite(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
  }
}

function decorateItem(item) {
  return publicOrderItem(item)
}

function decorate(row) {
  const cashier = staffLite(row.cashier)
  const customer = customerLite(row.customer)
  return {
    order: publicOrder(row, { cashier, customer }),
    items: (row.OrderItems || []).map(decorateItem),
    payments: row.Payments || [],
    cashier,
    customer,
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
    order: [["issued_at", "ASC"]],
  })
  if (!receipt) throw new NotFoundError("Receipt not found")
  return { receipt, ...view }
}

function publicRefund(refund, extras = {}) {
  const json = refund.toJSON ? refund.toJSON() : refund
  return {
    id: json.id,
    order_id: json.order_id,
    reason: json.reason,
    amount: Number(json.amount),
    tax_amount: Number(json.tax_amount),
    created_at: json.created_at,
    cashier: extras.cashier || staffLite(refund.cashier),
    items: extras.items || (refund.OrderRefundItems || []).map((row) => {
      const line = row.toJSON ? row.toJSON() : row
      return {
        ...line,
        quantity: Number(line.quantity),
        unit_price: Number(line.unit_price),
        tax_amount: Number(line.tax_amount),
        subtotal: Number(line.subtotal),
      }
    }),
    receipt: extras.receipt || refund.Receipt || null,
  }
}

export async function refundOrderItem(actor, id, fields) {
  const store = await getStoreForManager(actor.store_id)
  const order = await findOrder(store.id, id)
  assertCanSee(actor, order)
  if (!["completed", "refunded"].includes(order.order_status)) {
    throw new ConflictError("Only a completed sale can be item-refunded")
  }

  const item = (order.OrderItems || []).find((row) => row.id === fields.order_item_id)
  if (!item) throw new NotFoundError("Order item not found")

  const sold = Number(item.quantity)
  const already = Number(item.refunded_qty || 0)
  const remaining = sold - already
  const qty = Number(fields.quantity)
  if (qty > remaining + 1e-6) {
    throw new AppError(`Only ${remaining} remaining to refund`, 400)
  }

  const share = sold > 0 ? qty / sold : 0
  const lineSubtotal = money(Number(item.subtotal) * share)
  const lineTax = money(Number(item.tax_amount || 0) * share)
  const refundTotal = money(lineSubtotal + lineTax)
  const now = new Date()

  return sequelize.transaction(async (transaction) => {
    if (item.product_id && order.location_id) {
      const location = await getLocation(store.id, order.location_id)
      await restockSaleStock(
        {
          store,
          location,
          productId: item.product_id,
          qty,
          staffId: actor.id,
          orderId: order.id,
          isCustom: Boolean(order.is_custom),
        },
        { transaction }
      )
    }

    const receipt_number = await nextReceiptNumber(store.id, transaction)
    const receipt = await Receipt.create(
      {
        store_id: store.id,
        store_id_int: store.store_id_int,
        location_id: order.location_id,
        location_id_int: order.location_id_int,
        order_id: order.id,
        payment_id: null,
        receipt_number,
        cashier_id: actor.id,
        subtotal: lineSubtotal,
        discount_amount: 0,
        tax_amount: lineTax,
        shipping_fee: 0,
        total_amount: refundTotal,
        issued_at: now,
      },
      { transaction }
    )

    const refund = await OrderRefund.create(
      {
        store_id: store.id,
        store_id_int: store.store_id_int,
        location_id: order.location_id,
        location_id_int: order.location_id_int,
        order_id: order.id,
        cashier_id: actor.id,
        receipt_id: receipt.id,
        reason: fields.reason,
        amount: refundTotal,
        tax_amount: lineTax,
      },
      { transaction }
    )

    const refundItem = await OrderRefundItem.create(
      {
        refund_id: refund.id,
        order_item_id: item.id,
        product_id: item.product_id,
        title: item.title,
        quantity: qty,
        unit_price: item.unit_price,
        tax_amount: lineTax,
        subtotal: lineSubtotal,
      },
      { transaction }
    )

    await item.update({ refunded_qty: money(already + qty) }, { transaction })

    const items = await OrderItem.findAll({ where: { order_id: order.id }, transaction })
    const allRefunded = items.every(
      (row) => Number(row.refunded_qty || 0) + 1e-6 >= Number(row.quantity)
    )
    await order.update(
      {
        order_status: allRefunded ? "refunded" : "completed",
        payment_status: allRefunded ? "refunded" : order.payment_status,
      },
      { transaction }
    )

    if (order.register_session_id) {
      const session = await RegisterSession.findByPk(order.register_session_id, {
        transaction,
      })
      if (session && session.status === "clock_in") {
        await applySessionSale(
          session,
          {
            payments: [{ method: "cash", amount: refundTotal }],
            total: refundTotal,
            reverse: true,
          },
          { transaction }
        )
      }
    }

    await writeAudit({
      action: "refund",
      entity_type: "orders",
      entity_id: order.id,
      store_id: store.id,
      store_id_int: store.store_id_int,
      location_id: order.location_id,
      location_id_int: order.location_id_int,
      user_id: actor.id,
      channel: order.channel,
      note: fields.reason,
      after_data: { refund_id: refund.id, order_item_id: item.id, quantity: qty },
    })

    const cashier = staffLite(actor)
    return {
      kind: "refund",
      refund: publicRefund(refund, {
        cashier,
        items: [refundItem],
        receipt,
      }),
      receipt,
      cashier,
      customer: customerLite(order.customer),
      items: [
        {
          id: refundItem.id,
          title: item.title,
          quantity: qty,
          unit: item.unit,
          unit_price: Number(item.unit_price),
          subtotal: lineSubtotal,
          tax_amount: lineTax,
        },
      ],
      order: publicOrder(order, {
        cashier,
        customer: customerLite(order.customer),
        subtotal: lineSubtotal,
        tax_amount: lineTax,
        discount_amount: 0,
        total_amount: refundTotal,
        amount_paid: refundTotal,
        change_due: 0,
      }),
    }
  })
}

export async function getRefundReceipt(actor, orderId, refundId) {
  const view = await getOrderView(actor, orderId)
  const refund = await OrderRefund.findOne({
    where: { id: refundId, order_id: orderId, store_id: actor.store_id },
    include: [
      { model: OrderRefundItem },
      { model: Receipt },
      { model: User, as: "cashier", attributes: ["id", "name", "email", "phone", "role"] },
    ],
  })
  if (!refund) throw new NotFoundError("Refund not found")
  const receipt = refund.Receipt
  if (!receipt) throw new NotFoundError("Refund receipt not found")
  const cashier = staffLite(refund.cashier)
  const items = (refund.OrderRefundItems || []).map((row) => {
    const line = row.toJSON ? row.toJSON() : row
    const sold = view.items.find((item) => item.id === line.order_item_id)
    return {
      ...line,
      quantity: Number(line.quantity),
      unit: sold?.unit,
      unit_price: Number(line.unit_price),
      subtotal: Number(line.subtotal),
      tax_amount: Number(line.tax_amount),
    }
  })
  return {
    kind: "refund",
    refund: publicRefund(refund, { cashier, items, receipt }),
    receipt,
    items,
    order: {
      ...view.order,
      subtotal: Number(refund.amount) - Number(refund.tax_amount),
      tax_amount: Number(refund.tax_amount),
      discount_amount: 0,
      total_amount: Number(refund.amount),
      amount_paid: Number(refund.amount),
      change_due: 0,
      cashier,
    },
    cashier,
    customer: view.customer,
  }
}
