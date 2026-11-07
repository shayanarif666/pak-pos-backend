import { Op } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { visibilityFromOrderChannel, publicVisibility } from "../../db/channelVisibility.js"
import { Order } from "./order.model.js"
import { OrderItem } from "./orderItem.model.js"
import { OrderRefund } from "./orderRefund.model.js"
import { OrderRefundItem } from "./orderRefundItem.model.js"
import { Payment } from "../payments/payment.model.js"
import { Receipt } from "../payments/receipt.model.js"
import { User } from "../auth/user.model.js"
import { Location } from "../locations/location.model.js"
import { Customer } from "../customers/customer.model.js"
import { PaymentMethodTaxRate } from "../stores/paymentMethodTaxRate.model.js"
import { CustomerCreditEntry } from "../customers/customerCreditEntry.model.js"
import {
  nextOrderRefundItemNumber,
  nextOrderRefundNumber,
  nextReceiptNumber,
} from "../../shared/utils/counter.util.js"
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
import { money, splitRefund } from "../commerce/pricing.service.js"
import {
  applySessionSale,
} from "../pos/registerSession.service.js"
import { RegisterSession } from "../pos/registerSession.model.js"
import { requireApprovedAction } from "../pos/approval.service.js"
import { writeAudit } from "../../shared/utils/audit.util.js"
import { AppError } from "../../shared/errors/AppError.js"
import { SOLD_ORDER_STATUSES } from "../../db/enums.js"
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

  // Only checkout choices come from the customer. Discounts, tax exemption, custom lines and
  // tendered amounts are staff-only; spreading the raw body here let customers price their own orders.
  const result = await persistOrder(actor, {
    payment_method: fields.payment_method,
    payments: fields.payments,
    client_local_id: fields.client_local_id,
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
  if (actor.role === "customer") {
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
  if (query.status && !extraWhere.order_status) where.order_status = query.status
  if (query.payment_status) where.payment_status = query.payment_status
  if (query.from || query.to) {
    where.placed_at = {}
    if (query.from) where.placed_at[Op.gte] = new Date(query.from)
    if (query.to) where.placed_at[Op.lte] = new Date(query.to)
  }
  const q = String(query.q || "").trim().replace(/^#/, "")
  if (q && actor.role !== "customer") {
    // Search by order number, or by customer name / phone.
    const customers = await Customer.findAll({
      attributes: ["id"],
      where: {
        store_id: actor.store_id,
        [Op.or]: [{ name: { [Op.like]: `%${q}%` } }, { phone: { [Op.like]: `%${q}%` } }],
      },
    })
    const or = [{ customer_id: { [Op.in]: customers.map((row) => row.id) } }]
    if (/^\d+$/.test(q)) or.push({ order_number: Number(q) })
    where[Op.or] = or
  }

  const rows = await Order.findAll({
    where,
    include: [
      { model: Customer, as: "customer", attributes: ["id", "name", "phone"] },
      // Only to count the lines and units; the detail page loads them in full.
      { model: OrderItem, attributes: ["id", "quantity", "product_id"] },
    ],
    // placed_at has second precision; order_number keeps same-second sales in sequence.
    order: [
      ["placed_at", "DESC"],
      ["order_number", "DESC"],
    ],
  })
  const sessionIds = [...new Set(rows.map((row) => row.register_session_id).filter(Boolean))]
  const sessions = new Map(
    (sessionIds.length ? await RegisterSession.findAll({ where: { id: { [Op.in]: sessionIds } }, attributes: ["id", "session_number"] }) : []).map((row) => [row.id, row.session_number])
  )
  return rows.map((row) => {
    const lines = row.OrderItems || []
    return publicOrder(row, {
      customer: row.customer ? { id: row.customer.id, name: row.customer.name, phone: row.customer.phone } : null,
      // Lines on the order, and how many of them are custom (not from the catalog).
      item_count: lines.length,
      custom_item_count: lines.filter((line) => !line.product_id).length,
      batch: row.register_session_id ? { id: sessions.get(row.register_session_id) ?? null } : null,
    })
  })
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

/**
 * Sales per branch for the Sales tabs: how much each location sold and how its orders ended up.
 * Store admin sees every location (or one with ?location_id=); a manager only their own.
 * Filters: from, to (placed_at), channel, payment_method.
 * net_sales = completed sales minus partial refunds on those completed orders (fully refunded
 * orders are already outside completed sales).
 */
export async function salesByLocation(actor, query = {}) {
  const locationId = locationScope(actor, query)
  const where = { store_id: actor.store_id }
  if (locationId) where.location_id = locationId
  if (query.channel) where.channel = query.channel
  if (query.payment_method) where.payment_method = query.payment_method
  if (query.from || query.to) {
    where.placed_at = {}
    if (query.from) where.placed_at[Op.gte] = new Date(query.from)
    if (query.to) where.placed_at[Op.lte] = new Date(query.to)
  }

  const [orderRows, refundRows, locations] = await Promise.all([
    Order.findAll({
      where,
      attributes: [
        "location_id",
        "order_status",
        [sequelize.fn("COUNT", sequelize.col("id")), "orders"],
        [sequelize.fn("SUM", sequelize.col("total_amount")), "amount"],
      ],
      group: ["location_id", "order_status"],
      raw: true,
    }),
    OrderRefund.findAll({
      where: {
        store_id: actor.store_id,
        ...(locationId ? { location_id: locationId } : {}),
      },
      attributes: [
        [sequelize.col("OrderRefund.location_id"), "location_id"],
        [sequelize.col("Order.order_status"), "order_status"],
        [sequelize.fn("COUNT", sequelize.col("OrderRefund.id")), "refunds"],
        [sequelize.fn("SUM", sequelize.col("OrderRefund.amount")), "amount"],
      ],
      include: [{ model: Order, attributes: [], where, required: true }],
      group: ["OrderRefund.location_id", "Order.order_status"],
      raw: true,
    }),
    Location.findAll({
      where: { store_id: actor.store_id, ...(locationId ? { id: locationId } : {}) },
      attributes: ["id", "name", "is_active", "location_id_int"],
      order: [["location_id_int", "ASC"]],
    }),
  ])

  const empty = () => ({
    orders: 0,
    completed_orders: 0,
    sales: 0,
    pending_orders: 0,
    pending_amount: 0,
    cancelled_orders: 0,
    refunded_orders: 0,
    refunds_count: 0,
    refunds_amount: 0,
    partial_refunds: 0,
  })
  const byLocation = new Map(
    locations.map((loc) => [
      loc.id,
      { location_id: loc.id, location_name: loc.name, location_number: loc.location_id_int, is_active: loc.is_active, ...empty() },
    ])
  )
  const bucket = (id) => {
    const key = id || null
    if (!byLocation.has(key)) {
      byLocation.set(key, { location_id: key, location_name: key ? "Unknown location" : "No location", location_number: null, is_active: false, ...empty() })
    }
    return byLocation.get(key)
  }

  for (const row of orderRows) {
    const entry = bucket(row.location_id)
    const count = Number(row.orders) || 0
    const amount = Number(row.amount) || 0
    entry.orders += count
    if (SOLD_ORDER_STATUSES.includes(row.order_status)) {
      entry.completed_orders += count
      entry.sales += amount
    } else if (row.order_status === "pending") {
      entry.pending_orders += count
      entry.pending_amount += amount
    } else if (row.order_status === "cancelled" || row.order_status === "voided") {
      entry.cancelled_orders += count
    } else if (row.order_status === "refunded") {
      entry.refunded_orders += count
    }
  }
  for (const row of refundRows) {
    const entry = bucket(row.location_id)
    entry.refunds_count += Number(row.refunds) || 0
    entry.refunds_amount += Number(row.amount) || 0
    if (SOLD_ORDER_STATUSES.includes(row.order_status)) entry.partial_refunds += Number(row.amount) || 0
  }

  const rows = [...byLocation.values()].map((entry) => ({
    ...entry,
    sales: money(entry.sales),
    pending_amount: money(entry.pending_amount),
    refunds_amount: money(entry.refunds_amount),
    partial_refunds: money(entry.partial_refunds),
    net_sales: money(entry.sales - entry.partial_refunds),
  }))
  const totals = rows.reduce((sum, entry) => {
    for (const key of Object.keys(empty())) sum[key] = (sum[key] || 0) + entry[key]
    sum.net_sales = (sum.net_sales || 0) + entry.net_sales
    return sum
  }, {})
  for (const key of ["sales", "pending_amount", "refunds_amount", "partial_refunds", "net_sales"]) {
    totals[key] = money(totals[key] || 0)
  }
  return { locations: rows, totals }
}

export async function listOrderRefunds(actor, query = {}) {
  const where = { store_id: actor.store_id }
  const locationId = locationScope(actor, query)
  if (locationId) where.location_id = locationId
  if (query.from || query.to) {
    where.created_at = {}
    if (query.from) where.created_at[Op.gte] = new Date(query.from)
    if (query.to) where.created_at[Op.lte] = new Date(query.to)
  }

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
      refund_number: json.refund_number,
      refund_type: json.refund_type,
      location_id: json.location_id,
      location_number: json.location_id_int,
      order_id: json.order_id,
      order_number: row.Order?.order_number,
      order_status: row.Order?.order_status,
      reason: json.reason,
      amount: Number(json.amount),
      tax_amount: Number(json.tax_amount),
      payments: refundPaymentsOf(json),
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
  const view = decorate(row)
  // The batch (register session) it was rung up in.
  if (row.register_session_id) {
    const session = await RegisterSession.findByPk(row.register_session_id, { attributes: ["id", "session_number", "status"] })
    if (session) view.order.batch = { id: session.session_number, status: session.status }
  }
  return view
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
  if (![...SOLD_ORDER_STATUSES, "pending"].includes(order.order_status)) {
    throw new ConflictError("Cannot add a payment to this order")
  }

  const payment = await Payment.create({
    store_id: order.store_id,
    store_id_int: order.store_id_int,
    location_id: order.location_id,
    location_id_int: order.location_id_int,
    order_id: order.id,
    ...visibilityFromOrderChannel(order.channel),
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
    payment_status: amount_paid + 0.009 >= Number(order.total_amount) ? "paid" : amount_paid > 0 ? "partial" : "pending",
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
        qty: Number(item.quantity) - Number(item.refunded_qty || 0),
        staffId: actor.id,
        orderId: order.id,
        isCustom: false,
        item,
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
      if (session && session.status === "open") {
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
  if (SOLD_ORDER_STATUSES.includes(order.order_status)) {
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
  return { receipt: receipt || null, ...view }
}

// How a refund was paid back; older refunds (no breakdown) were all cash.
function refundPaymentsOf(json) {
  if (Array.isArray(json.payments)) return json.payments
  return [{ method: "cash", amount: Number(json.amount) }]
}

function publicRefund(refund, extras = {}) {
  const json = refund.toJSON ? refund.toJSON() : refund
  return {
    id: json.id,
    order_id: json.order_id,
    refund_number: json.refund_number,
    reason: json.reason,
    amount: Number(json.amount),
    tax_amount: Number(json.tax_amount),
    payments: refundPaymentsOf(json),
    created_at: json.created_at,
    ...publicVisibility(json),
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

// What each method paid toward the order (payment tax included), plus the udhaar left as
// "credit". An order with no payment rows, or credit without a customer, counts as cash.
function refundBuckets(order) {
  const byMethod = new Map()
  for (const payment of order.Payments || []) {
    if (["failed", "cancelled", "refunded"].includes(payment.status)) continue
    const entry = byMethod.get(payment.method) || { method: payment.method, amount: 0, tax: 0 }
    entry.amount += Number(payment.amount || 0)
    entry.tax += Number(payment.tax_amount || 0)
    byMethod.set(payment.method, entry)
  }
  const paidTotal = [...byMethod.values()].reduce((sum, entry) => sum + entry.amount, 0)
  const unpaid = money(Number(order.total_amount || 0) - paidTotal)
  if (unpaid > 0) {
    const method = order.customer_id ? "credit" : "cash"
    const entry = byMethod.get(method) || { method, amount: 0, tax: 0 }
    entry.amount += unpaid
    byMethod.set(method, entry)
  }
  const rates = order.tax_breakdown?.payment_gst || []
  return [...byMethod.values()].map((entry) => {
    const rate = rates.find((row) => row.method === entry.method)
    const share = entry.amount - entry.tax
    return {
      method: entry.method,
      amount: money(entry.amount),
      gst_percent: Number(rate?.gst_percent ?? (share > 0 ? money((entry.tax / share) * 100) : 0)),
    }
  })
}

// What earlier refunds of the order paid back per method (older ones were all cash).
async function refundedByMethod(orderId) {
  const rows = await OrderRefund.findAll({
    where: { order_id: orderId },
    attributes: ["amount", "payments"],
  })
  const refunded = {}
  for (const row of rows) {
    const parts = Array.isArray(row.payments) ? row.payments : [{ method: "cash", amount: row.amount }]
    for (const part of parts) {
      refunded[part.method] = money((refunded[part.method] || 0) + Number(part.amount || 0))
    }
  }
  return refunded
}

export async function refundOrderItem(actor, id, fields) {
  const store = await getStoreForManager(actor.store_id)
  const order = await findOrder(store.id, id)
  assertCanSee(actor, order)
  if (![...SOLD_ORDER_STATUSES, "refunded"].includes(order.order_status)) {
    throw new ConflictError("Only a completed sale can be item-refunded")
  }

  // The line by UUID, or by its item number inside this order (1, 2, 3...).
  const ref = String(fields.order_item_id)
  const item = (order.OrderItems || []).find(
    (row) => row.id === ref || String(row.item_number) === ref
  )
  if (!item) throw new NotFoundError("Order item not found")

  const sold = Number(item.quantity)
  const already = Number(item.refunded_qty || 0)
  const remaining = sold - already
  const qty = Number(fields.quantity)
  if (qty > remaining + 1e-6) {
    throw new AppError(`Only ${remaining} remaining to refund`, 400)
  }

  const share = sold > 0 ? qty / sold : 0
  // Order-level discount and coupon are spread over the lines: the customer gets back
  // only what they actually paid for this line, never the pre-discount price.
  const orderGoods = Number(order.subtotal || 0)
  const orderLevelDiscount =
    Number(order.discount_amount || 0) + Number(order.coupon_discount_amount || 0)
  const keptFactor =
    orderGoods > 0 ? Math.max(0, (orderGoods - orderLevelDiscount) / orderGoods) : 1
  const lineSubtotal = money(Number(item.subtotal) * keptFactor * share)
  const lineTax = money(Number(item.tax_amount || 0) * share)

  // Paid back the way the sale was paid: each method gets its own part back, with the payment
  // tax it was charged (card 5% stays 5%). The fraction refunded counts every line's refunded
  // qty, this one included, so the last refund closes each method out to the paisa.
  const preGstOf = (row) => Number(row.subtotal || 0) * keptFactor + Number(row.tax_amount || 0)
  const lines = order.OrderItems || []
  const linesPreGst = lines.reduce((sum, row) => sum + preGstOf(row), 0)
  const refundedPreGst = lines.reduce((sum, row) => {
    const done = Number(row.refunded_qty || 0) + (row.id === item.id ? qty : 0)
    return sum + (Number(row.quantity) > 0 ? (preGstOf(row) * done) / Number(row.quantity) : 0)
  }, 0)
  const buckets = refundBuckets(order)
  const orderPreGst = Number(order.total_amount || 0) - Number(order.payment_gst_amount || 0)
  const refundPayments = splitRefund({
    buckets,
    refunded: await refundedByMethod(order.id),
    fraction: linesPreGst > 0 ? refundedPreGst / linesPreGst : 0,
    goodsShare:
      orderPreGst > 0 ? Math.max(0, (orderPreGst - Number(order.shipping_fee || 0)) / orderPreGst) : 1,
  })
  const refundTotal = money(refundPayments.reduce((sum, row) => sum + row.amount, 0))
  // Line tax + payment tax (any paisa from rounding lands here, so subtotal + tax = total).
  const refundTax = money(Math.max(0, refundTotal - lineSubtotal))
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
          item,
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
        ...visibilityFromOrderChannel(order.channel),
        payment_id: null,
        receipt_number,
        cashier_id: actor.id,
        subtotal: lineSubtotal,
        discount_amount: 0,
        tax_amount: refundTax,
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
        refund_number: await nextOrderRefundNumber(store.id, transaction),
        location_id: order.location_id,
        location_id_int: order.location_id_int,
        order_id: order.id,
        ...visibilityFromOrderChannel(order.channel),
        cashier_id: actor.id,
        receipt_id: receipt.id,
        reason: fields.reason,
        refund_type: fields.refund_type === "complete" ? "complete" : "partial",
        amount: refundTotal,
        tax_amount: refundTax,
        payments: refundPayments,
      },
      { transaction }
    )

    const refundItem = await OrderRefundItem.create(
      {
        refund_id: refund.id,
        item_number: await nextOrderRefundItemNumber(refund.id, transaction),
        ...visibilityFromOrderChannel(order.channel),
        order_item_id: item.id,
        product_id: item.product_id,
        title: item.title,
        quantity: qty,
        unit_price: item.unit_price,
        tax_amount: refundTax,
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
        // Some items back: partial_refunded; the payment status stays as it was (paid / partial).
        order_status: allRefunded ? "refunded" : "partial_refunded",
        payment_status: allRefunded ? "refunded" : order.payment_status,
      },
      { transaction }
    )

    // The udhaar part is taken off what the customer owes, not paid out.
    const creditBack = refundPayments.find((row) => row.method === "credit")
    if (creditBack && order.customer_id) {
      const customer = await getCustomer(order.store_id, order.customer_id)
      await recordLedgerEntry(
        customer,
        {
          entry_type: "credit",
          amount: creditBack.amount,
          order_id: order.id,
          created_by: actor.id,
          note: `Refund #${refund.refund_number} of order #${order.order_number}`,
        },
        { transaction }
      )
    }

    if (order.register_session_id) {
      const session = await RegisterSession.findByPk(order.register_session_id, {
        transaction,
      })
      if (session && session.status === "open") {
        await applySessionSale(
          session,
          {
            payments: refundPayments.filter((row) => row.method !== "credit"),
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

export async function refundEntireOrder(actor, id, fields) {
  const store = await getStoreForManager(actor.store_id)
  const order = await findOrder(store.id, id)
  assertCanSee(actor, order)
  if (![...SOLD_ORDER_STATUSES, "refunded"].includes(order.order_status)) {
    throw new ConflictError("Only a completed sale can be refunded")
  }

  const refunds = []
  for (const item of order.OrderItems || []) {
    const remaining = Number(item.quantity) - Number(item.refunded_qty || 0)
    if (remaining <= 1e-6) continue
    refunds.push(
      await refundOrderItem(actor, id, {
        order_item_id: item.id,
        quantity: remaining,
        reason: fields.reason,
        refund_type: "complete",
      })
    )
  }
  if (!refunds.length) throw new AppError("Nothing left to refund", 400)
  return { order_id: id, refunds }
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
    customer: view.customer,
  }
}

// ---- Order updates (money stays as sold: totals, items and taxes are never edited) ----

/** A pending (web / COD) order delivered and paid: its payments succeed and it completes. */
export async function completePendingOrder(actor, id) {
  const order = await findOrder(actor.store_id, id)
  assertCanSee(actor, order)
  if (order.order_status !== "pending") throw new ConflictError("Only a pending order can be completed")
  return sequelize.transaction(async (transaction) => {
    const now = new Date()
    for (const payment of order.Payments || []) {
      if (payment.status === "initiated") {
        await payment.update({ status: "success", paid_at: now }, { transaction })
      }
    }
    await order.update(
      {
        order_status: "completed",
        payment_status: "paid",
        amount_paid: Math.max(Number(order.amount_paid || 0), Number(order.total_amount || 0)),
      },
      { transaction }
    )
    await writeAudit({
      action: "update",
      entity_type: "orders",
      entity_id: order.id,
      store_id: order.store_id,
      store_id_int: order.store_id_int,
      location_id: order.location_id,
      location_id_int: order.location_id_int,
      user_id: actor.id,
      channel: order.channel,
      note: "Order completed",
    })
    return publicOrder(await findOrder(actor.store_id, id))
  })
}

/**
 * The cashier pressed the wrong method (e.g. cash instead of card). Only for a one-method sale
 * that has no refund yet, while its batch is still open, and only between methods with the same
 * payment tax — otherwise the bill itself changes, so void it and ring it up again.
 */
export async function changePaymentMethod(actor, id, method) {
  const order = await findOrder(actor.store_id, id)
  assertCanSee(actor, order)
  if (order.order_status !== "completed") throw new ConflictError("Only a completed sale can change its payment method")
  const payments = (order.Payments || []).filter((row) => row.status !== "failed")
  if (payments.length !== 1 || order.payment_method === "mixed") {
    throw new ConflictError("A split payment cannot be changed; void it and ring it up again")
  }
  const payment = payments[0]
  if (payment.method === method) return publicOrder(order)
  if (await OrderRefund.count({ where: { order_id: order.id } })) {
    throw new ConflictError("This sale has a refund; its payment method cannot change")
  }
  const session = order.register_session_id ? await RegisterSession.findByPk(order.register_session_id) : null
  if (session && session.status !== "open") {
    throw new ConflictError("The batch of this sale is closed; its payment method cannot change")
  }
  const charged = Number(payment.tax_amount || 0)
  if (charged > 0) {
    const rate = await PaymentMethodTaxRate.findOne({ where: { store_id: order.store_id, payment_method: method } })
    const share = Number(payment.amount) - charged
    const newTax = money((share * Number(rate?.gst_percent || 0)) / 100)
    if (Math.abs(newTax - charged) > 0.01) {
      throw new ConflictError(
        `${payment.method} and ${method} have a different payment tax, so the bill would change; void it and ring it up again`
      )
    }
  }

  return sequelize.transaction(async (transaction) => {
    const before = payment.method
    await payment.update({ method }, { transaction })
    const breakdown = order.tax_breakdown && typeof order.tax_breakdown === "object" ? order.tax_breakdown : null
    const splits = Array.isArray(breakdown?.payment_gst)
      ? breakdown.payment_gst.map((row) => (row.method === before ? { ...row, method } : row))
      : null
    await order.update(
      { payment_method: method, ...(splits ? { tax_breakdown: { ...breakdown, payment_gst: splits } } : {}) },
      { transaction }
    )
    // The drawer: the amount moves from the old method's total to the new one's.
    if (session) {
      const amount = Number(payment.amount)
      await applySessionSale(session, { payments: [{ method: before, amount }], total: amount, reverse: true }, { transaction })
      await applySessionSale(session, { payments: [{ method, amount }], total: amount }, { transaction })
    }
    await writeAudit({
      action: "update",
      entity_type: "orders",
      entity_id: order.id,
      store_id: order.store_id,
      store_id_int: order.store_id_int,
      location_id: order.location_id,
      location_id_int: order.location_id_int,
      user_id: actor.id,
      channel: order.channel,
      note: `Payment method ${before} -> ${method}`,
    })
    return publicOrder(await findOrder(actor.store_id, id))
  })
}

/** The cashier forgot to pick the customer: attach one to a sale that has none. */
export async function attachOrderCustomer(actor, id, customerId) {
  const order = await findOrder(actor.store_id, id)
  assertCanSee(actor, order)
  if (order.customer_id && order.customer_id !== customerId) {
    throw new ConflictError("This order already has a customer")
  }
  const customer = await getCustomer(order.store_id, customerId)
  await order.update({ customer_id: customer.id })
  return publicOrder(await findOrder(actor.store_id, id))
}

// ---- POS refunds: the till works out every figure, the server saves them as sent ----

const REFUND_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

function refundTime(value, now) {
  if (!value) return now
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) throw new AppError("refunded_at is not a valid date", 400)
  if (at.getTime() > now.getTime() + 5 * 60 * 1000) throw new AppError("refunded_at cannot be in the future", 400)
  if (now.getTime() - at.getTime() > REFUND_MAX_AGE_MS) throw new AppError("Offline refund is older than 30 days", 400)
  return at
}

/** The batch the money leaves from: the one sent (number or UUID), else the staff member's open one. */
async function refundSession(storeId, ref, actor, transaction) {
  if (ref) {
    const where = /^\d+$/.test(String(ref)) ? { store_id: storeId, session_number: Number(ref) } : { store_id: storeId, id: ref }
    const session = await RegisterSession.findOne({ where, transaction })
    if (!session) throw new NotFoundError(`Batch ${ref} not found`)
    return session
  }
  return RegisterSession.findOne({ where: { store_id: storeId, cashier_id: actor.id, status: "open" }, order: [["opened_at", "DESC"]], transaction })
}

/**
 * POST /orders/refunds/bulk and /refunds/complete/bulk with lines[]: one refund (and one receipt) for
 * the order, its lines and payments exactly as the till sent them. The server only checks: each qty
 * is not more than what is left on its line, a complete refund gives back everything left, and
 * total_amount = the sum of the payments (checked when parsed). client_local_id makes it safe to
 * send again. restock false keeps that qty out of stock (damaged / expired).
 */
export async function refundPosOrder(actor, id, fields, { complete = false } = {}) {
  const store = await getStoreForManager(actor.store_id)
  const existing = await OrderRefund.findOne({ where: { store_id: store.id, client_local_id: fields.client_local_id } })
  if (existing) return { refund: existing, idempotent: true }

  const order = await findOrder(store.id, id)
  assertCanSee(actor, order)
  if (![...SOLD_ORDER_STATUSES, "refunded"].includes(order.order_status)) {
    throw new ConflictError("Only a completed sale can be refunded")
  }
  const items = order.OrderItems || []
  const packOf = (item) => (item.sale_unit === "pack" ? Number(item.pack_size) || 1 : 1)
  const picked = fields.lines.map((line) => {
    const ref = String(line.order_item_id)
    const item = items.find((row) => row.id === ref || String(row.item_number) === ref)
    if (!item) throw new NotFoundError(`Order ${order.order_number} has no line ${ref}`)
    // qty is in the unit the line was sold in (packs on a pack line); stock and refunded_qty are units.
    const units = Number((line.qty * packOf(item)).toFixed(4))
    const left = Number(item.quantity) - Number(item.refunded_qty || 0)
    if (units > left + 1e-6) {
      throw new AppError(`Order ${order.order_number} line ${item.item_number}: only ${Number((left / packOf(item)).toFixed(4))} left to refund (${line.qty} sent)`, 400)
    }
    return { line, item, units }
  })
  if (new Set(picked.map((row) => row.item.id)).size !== picked.length) {
    throw new AppError("A line is listed twice: send it once with its whole qty", 400)
  }
  if (complete) {
    for (const item of items) {
      const left = Number(item.quantity) - Number(item.refunded_qty || 0)
      const sent = picked.find((row) => row.item.id === item.id)?.units || 0
      if (left - sent > 1e-6) {
        throw new AppError(
          `Order ${order.order_number}: a complete refund must give back every remaining line (line ${item.item_number} has ${Number(((left - sent) / packOf(item)).toFixed(4))} left)`,
          400
        )
      }
    }
  }

  const now = new Date()
  const refundedAt = refundTime(fields.refunded_at, now)
  const sum = (rows, key) => money(rows.reduce((total, row) => total + Number(row[key] || 0), 0))
  const lineAmount = sum(fields.lines, "amount")
  const lineTax = sum(fields.lines, "tax_amount")
  const discount = sum(fields.lines, "discount_amount")
  const surcharge = sum(fields.payments, "surcharge_amount")
  const total = money(fields.total_amount)

  return sequelize.transaction(async (transaction) => {
    const location = order.location_id ? await Location.findByPk(order.location_id, { transaction }) : null
    for (const { line, item, units } of picked) {
      if (line.restock && item.product_id && location) {
        await restockSaleStock(
          { store, location, productId: item.product_id, qty: units, staffId: actor.id, orderId: order.id, isCustom: Boolean(order.is_custom), item },
          { transaction }
        )
      }
    }

    const receipt = await Receipt.create(
      {
        store_id: store.id,
        store_id_int: store.store_id_int,
        location_id: order.location_id,
        location_id_int: order.location_id_int,
        order_id: order.id,
        ...visibilityFromOrderChannel(order.channel),
        payment_id: null,
        receipt_number: await nextReceiptNumber(store.id, transaction),
        cashier_id: actor.id,
        subtotal: lineAmount,
        discount_amount: discount,
        tax_amount: money(lineTax + surcharge),
        shipping_fee: 0,
        total_amount: total,
        issued_at: refundedAt,
      },
      { transaction }
    )

    const session = await refundSession(store.id, fields.batch_ref, actor, transaction)
    const refund = await OrderRefund.create(
      {
        store_id: store.id,
        store_id_int: store.store_id_int,
        refund_number: await nextOrderRefundNumber(store.id, transaction),
        location_id: order.location_id,
        location_id_int: order.location_id_int,
        order_id: order.id,
        ...visibilityFromOrderChannel(order.channel),
        cashier_id: actor.id,
        receipt_id: receipt.id,
        reason: fields.reason,
        refund_type: complete ? "complete" : "partial",
        amount: total,
        // Line taxes + payment surcharges (amount - tax = what the goods were worth after discount).
        tax_amount: money(total - lineAmount),
        discount_amount: discount,
        surcharge_amount: surcharge,
        payments: fields.payments,
        client_local_id: fields.client_local_id,
        refunded_at: refundedAt,
        register_session_id: session?.id || null,
      },
      { transaction }
    )

    let itemNumber = 0
    for (const { line, item, units } of picked) {
      itemNumber += 1
      await OrderRefundItem.create(
        {
          refund_id: refund.id,
          item_number: itemNumber,
          ...visibilityFromOrderChannel(order.channel),
          order_item_id: item.id,
          product_id: item.product_id,
          title: item.title,
          quantity: units,
          unit_price: item.unit_price,
          subtotal: line.amount,
          tax_amount: line.tax_amount,
          discount_amount: line.discount_amount,
          line_taxes: line.taxes,
          restocked: Boolean(line.restock && item.product_id),
        },
        { transaction }
      )
      await item.update({ refunded_qty: money(Number(item.refunded_qty || 0) + units) }, { transaction })
    }

    const after = await OrderItem.findAll({ where: { order_id: order.id }, transaction })
    const allBack = after.every((row) => Number(row.refunded_qty || 0) + 1e-6 >= Number(row.quantity))
    await order.update(
      {
        order_status: allBack ? "refunded" : "partial_refunded",
        payment_status: allBack ? "refunded" : order.payment_status,
      },
      { transaction }
    )

    // The udhaar part comes off what the customer owes; it is not paid out.
    const creditBack = fields.payments.find((row) => row.method === "credit")
    if (creditBack && order.customer_id) {
      const customer = await getCustomer(order.store_id, order.customer_id)
      await recordLedgerEntry(
        customer,
        { entry_type: "credit", amount: creditBack.amount, order_id: order.id, created_by: actor.id, note: `Refund #${refund.refund_number} of order #${order.order_number}` },
        { transaction }
      )
    }
    // The money leaves the batch it was paid out of (the drawer open now).
    if (session && session.status === "open") {
      await applySessionSale(
        session,
        { payments: fields.payments.filter((row) => row.method !== "credit"), total, reverse: true },
        { transaction }
      )
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
      after_data: { refund_id: refund.id, lines: picked.map(({ item, units, line }) => ({ order_item_id: item.id, quantity: units, restock: line.restock })) },
    })
    return { refund }
  })
}
