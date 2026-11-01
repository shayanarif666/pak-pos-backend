/**
 * POS (channel=pos) response shapes. The POS works with short numbers (order_number,
 * user_number, location number...), so each builder turns the stored UUIDs into those numbers
 * and uses the field names of the POS contract (staffId, locationId, batchId...).
 *
 * Next to each id the reply carries a small summary of what it points at — staff { id, name,
 * role }, location { id, name }, product { id, title, sku, unit }... — so a screen never has to
 * look ids up one by one. The lookups are batched: a list loads every referenced row of a table
 * with one IN (...) query (see Refs), never one query per row.
 */
import { Op } from "sequelize"
import { Order } from "../orders/order.model.js"
import { OrderItem } from "../orders/orderItem.model.js"
import { OrderRefund } from "../orders/orderRefund.model.js"
import { OrderRefundItem } from "../orders/orderRefundItem.model.js"
import { Receipt } from "../payments/receipt.model.js"
import { Payment } from "../payments/payment.model.js"
import { Store } from "../stores/store.model.js"
import { Location } from "../locations/location.model.js"
import { User } from "../auth/user.model.js"
import { Customer } from "../customers/customer.model.js"
import { Product } from "../catalog/product.model.js"
import { Category } from "../catalog/category.model.js"
import { Supplier } from "../inventory/supplier.model.js"
import { RegisterSession } from "./registerSession.model.js"
import { publicTransfer } from "../inventory/transfer.service.js"
import { buildReceiptView, buildRefundReceiptView, remainingAmountOf } from "./receiptView.js"

export const num = (value) => (value == null ? null : Number(value))

/** Map(uuid -> short number) for one model's rows. */
export async function numbersOf(model, column, ids) {
  const list = [...new Set(ids.filter(Boolean))]
  if (!list.length) return new Map()
  const rows = await model.findAll({ where: { id: { [Op.in]: list } }, attributes: ["id", column] })
  return new Map(rows.map((row) => [row.id, row[column]]))
}

export const one = async (model, column, id) => (id ? (await numbersOf(model, column, [id])).get(id) ?? null : null)

export async function currencyOf(storeId) {
  const store = await Store.findByPk(storeId, { attributes: ["currency"] })
  return store?.currency || "PKR"
}

// ---- Batched lookups ----

const KINDS = {
  user: { model: User, attributes: ["id", "user_number", "name", "role"] },
  location: { model: Location, attributes: ["id", "location_id_int", "name"] },
  product: {
    model: Product,
    attributes: ["id", "product_number", "title", "sku", "unit", "category_id", "parent_product_id", "variant_number", "variant_name"],
  },
  category: { model: Category, attributes: ["id", "category_number", "name", "tax_name"] },
  supplier: { model: Supplier, attributes: ["id", "supplier_number", "name", "phone"] },
  customer: { model: Customer, attributes: ["id", "customer_number", "name", "phone"] },
  batch: { model: RegisterSession, attributes: ["id", "session_number", "status"] },
  order: { model: Order, attributes: ["id", "order_number", "order_status"] },
  receipt: { model: Receipt, attributes: ["id", "receipt_number"] },
}

/** Rows of other tables a reply points at, loaded per table with one IN (...) query. */
export class Refs {
  constructor() {
    this.rows = Object.fromEntries(Object.keys(KINDS).map((kind) => [kind, new Map()]))
  }

  /** Loads the given ids of a kind (already loaded ones are skipped). */
  async load(kind, ids) {
    const { model, attributes } = KINDS[kind]
    const missing = [...new Set(ids.filter(Boolean))].filter((id) => !this.rows[kind].has(id))
    if (!missing.length) return this
    const rows = await model.findAll({ where: { id: { [Op.in]: missing } }, attributes })
    for (const row of rows) this.rows[kind].set(row.id, row)
    // A variant's product too (its reply shows the product and the variant).
    if (kind === "product") await this.load("product", rows.map((row) => row.parent_product_id))
    return this
  }

  /** Loads several kinds at once: { user: [ids], location: [ids], ... }. */
  async loadAll(spec) {
    await Promise.all(Object.entries(spec).map(([kind, ids]) => this.load(kind, ids)))
    return this
  }

  get(kind, id) {
    return id ? this.rows[kind].get(id) || null : null
  }

  // Short number of a row (null when not set / not found).
  number(kind, id) {
    const row = this.get(kind, id)
    if (!row) return null
    const key = { user: "user_number", location: "location_id_int", product: "product_number", category: "category_number", supplier: "supplier_number", customer: "customer_number", batch: "session_number", order: "order_number", receipt: "receipt_number" }[kind]
    return row[key] ?? null
  }

  // Embedded summaries.
  staff(id) {
    const row = this.get("user", id)
    return row ? { id: row.user_number, name: row.name, role: row.role } : null
  }
  location(id) {
    const row = this.get("location", id)
    return row ? { id: row.location_id_int, name: row.name } : null
  }
  /**
   * A product { id, title, sku, unit }. A variant: its product's number and title, its own sku,
   * and variant { id (number inside the product), name } — as the POS sends product_id + variant_id.
   */
  product(id) {
    const row = this.get("product", id)
    if (!row) return null
    const parent = row.parent_product_id ? this.get("product", row.parent_product_id) : null
    if (!parent) return { id: row.product_number, title: row.title, sku: row.sku, unit: row.unit }
    return {
      id: parent.product_number,
      title: parent.title,
      sku: row.sku,
      unit: row.unit,
      variant: { id: row.variant_number, name: row.variant_name },
    }
  }
  /** { product, variant }: a variant shows its product (load parents first) and its own number. */
  productAndVariant(id) {
    const row = this.get("product", id)
    if (!row) return { product: null, variant: null }
    if (!row.parent_product_id) return { product: this.product(id), variant: null }
    return {
      product: this.product(row.parent_product_id),
      variant: { id: row.variant_number, name: row.variant_name, sku: row.sku },
    }
  }
  category(id) {
    const row = this.get("category", id)
    return row ? { id: row.category_number, name: row.name } : null
  }
  supplier(id) {
    const row = this.get("supplier", id)
    return row ? { id: row.supplier_number, name: row.name, phone: row.phone || null } : null
  }
  customer(id) {
    const row = this.get("customer", id)
    return row ? { id: row.customer_number, name: row.name, phone: row.phone || null } : null
  }
  batch(id) {
    const row = this.get("batch", id)
    return row ? { id: row.session_number, status: row.status } : null
  }
  order(id) {
    const row = this.get("order", id)
    return row ? { id: row.order_number, status: row.order_status } : null
  }
}

/** Currency code by store id, for the stores of a list (one query). */
async function currencyFor(storeIds) {
  const ids = [...new Set(storeIds.filter(Boolean))]
  const stores = ids.length ? await Store.findAll({ where: { id: { [Op.in]: ids } }, attributes: ["id", "currency"] }) : []
  const byId = new Map(stores.map((store) => [store.id, store.currency || "PKR"]))
  return (storeId) => byId.get(storeId) || "PKR"
}

const byIds = (rows, ids) => {
  const map = new Map(rows.map((row) => [row.id, row]))
  return ids.map((id) => map.get(id)).filter(Boolean)
}

// ---- Orders ----

/** Orders by UUID, in the given order, with their items and every summary. */
export async function posOrders(orderIds) {
  const ids = [...new Set(orderIds.filter(Boolean))]
  if (!ids.length) return []
  const orders = byIds(
    await Order.findAll({
      where: { id: { [Op.in]: ids } },
      include: [{ model: OrderItem }, { model: Payment, attributes: ["amount", "status"] }],
    }),
    ids
  )
  const credit = await creditRefundedByOrder(ids)
  const items = orders.flatMap((order) => order.OrderItems || [])
  const refs = await new Refs().loadAll({
    user: orders.flatMap((order) => [order.cashier_id, order.cancelled_by]),
    customer: orders.map((order) => order.customer_id),
    batch: orders.map((order) => order.register_session_id),
    location: orders.map((order) => order.location_id),
    product: items.map((item) => item.product_id),
  })
  // The line's category as sold; older lines (saved before it was kept) fall back to the product's.
  await refs.load(
    "category",
    items.map((item) => item.category_id || refs.get("product", item.product_id)?.category_id)
  )
  const currency = await currencyFor(orders.map((order) => order.store_id))
  return orders.map((order) =>
    orderView(order, refs, currency(order.store_id), remainingAmountOf(order, order.Payments, credit.get(order.id) || 0))
  )
}

export async function posOrder(orderId) {
  return (await posOrders([orderId]))[0] || null
}

function parseList(value) {
  if (Array.isArray(value)) return value
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function orderItemView(item, refs) {
  const lineTotal = Number(item.subtotal || 0) + Number(item.tax_amount || 0)
  const prices = {
    unit_price: num(item.unit_price),
    discount_amount: num(item.discount_amount) ?? 0,
    subtotal: num(item.subtotal),
    tax_amount: num(item.tax_amount) ?? 0,
    total: Number(lineTotal.toFixed(2)),
  }
  if (item.product_id) {
    const categoryId = item.category_id || refs.get("product", item.product_id)?.category_id
    const category = refs.category(categoryId)
    return {
      id: item.item_number,
      // The product as sold: the title saved on the line (it may have been renamed since).
      product: { ...(refs.product(item.product_id) || { id: null, sku: null, unit: null }), title: item.title },
      category: category ? { ...category, name: item.category_name || category.name } : null,
      qty: num(item.quantity),
      ...prices,
      // Where the discount came from (none | product | category | product+category | bulk_tier |
      // offer) and the offer(s) applied, as they were at the sale. null on lines sold before this was kept.
      discount_source: item.discount_source || null,
      offers: parseList(item.offers),
      free_qty: num(item.free_qty) ?? 0,
    }
  }
  return {
    id: item.item_number,
    category: item.custom_category || null,
    title: item.title,
    price: num(item.unit_price),
    qty: num(item.quantity),
    ...prices,
  }
}

function paymentSplitsOf(order) {
  let breakdown = order.tax_breakdown
  if (typeof breakdown === "string") {
    try {
      breakdown = JSON.parse(breakdown)
    } catch {
      breakdown = null
    }
  }
  return Array.isArray(breakdown?.payment_gst) ? breakdown.payment_gst : []
}

function orderView(order, refs, currency, remainingAmount = 0) {
  const items = [...(order.OrderItems || [])].sort((a, b) => a.item_number - b.item_number)
  // subtotal here includes the product and category tax of the lines.
  const subtotal =
    Number(order.subtotal) + Number(order.product_tax_amount || 0) + Number(order.category_tax_amount || 0)
  return {
    id: order.order_number,
    location: refs.location(order.location_id),
    is_custom: Boolean(order.is_custom),
    offer_exempt: Boolean(order.offer_exempt),
    staff: refs.staff(order.cashier_id),
    customer: refs.customer(order.customer_id),
    batch: refs.batch(order.register_session_id),
    currency,
    order_items: items.map((item) => orderItemView(item, refs)),
    subtotal: Number(subtotal.toFixed(2)),
    is_order_discounted: Boolean(order.is_order_discounted),
    order_discount_type: order.order_discount_type,
    discount_amount: num(order.discount_amount),
    payment_method: order.payment_method,
    payment_status: order.payment_status,
    payment_gst_amount: num(order.payment_gst_amount),
    tax_amount: num(order.tax_amount),
    // Per method: its share of the bill, its payment tax, what it paid toward the bill and what was handed over.
    payments: paymentSplitsOf(order).map((row) => ({
      method: row.method,
      bill_share: num(row.bill_share),
      payment_tax_percent: num(row.gst_percent),
      payment_tax_amount: num(row.gst_amount) ?? 0,
      amount: num(row.amount),
      paid: num(row.paid ?? row.amount),
      change: num(row.change) ?? 0,
    })),
    fbr_invoice_enabled: Boolean(order.fbr_invoice_enabled),
    fbr_tax_amount: num(order.fbr_tax_amount),
    order_status: order.order_status,
    total_amount: num(order.total_amount),
    amount_paid: num(order.amount_paid),
    change_due: num(order.change_due),
    // Udhaar still owed on this sale (payment_status partial); 0 when fully paid.
    remaining_amount: remainingAmount,
    cancel_reason: order.cancel_reason || order.void_reason || null,
    cancelled_by: refs.staff(order.cancelled_by),
    placed_at: order.placed_at,
    channel: order.channel,
    is_pos_visible: Boolean(order.is_pos_visible),
    is_web_visible: Boolean(order.is_web_visible),
  }
}

// ---- Refunds ----

/**
 * Refunds by UUID, in the given order: amount = refunded value before tax, tax, total = what went
 * back to the customer; items = the refunded lines.
 */
export async function posRefunds(refundIds) {
  const ids = [...new Set(refundIds.filter(Boolean))]
  if (!ids.length) return []
  const refunds = byIds(await OrderRefund.findAll({ where: { id: { [Op.in]: ids } }, include: [{ model: OrderRefundItem }] }), ids)
  const lines = refunds.flatMap((refund) => refund.OrderRefundItems || [])
  const [refs, soldLines] = await Promise.all([
    new Refs().loadAll({
      user: refunds.map((refund) => refund.cashier_id),
      order: refunds.map((refund) => refund.order_id),
      receipt: refunds.map((refund) => refund.receipt_id),
      location: refunds.map((refund) => refund.location_id),
      product: lines.map((line) => line.product_id),
    }),
    OrderItem.findAll({ where: { id: { [Op.in]: lines.map((line) => line.order_item_id).filter(Boolean) } }, attributes: ["id", "item_number"] }),
  ])
  const itemNumber = new Map(soldLines.map((row) => [row.id, row.item_number]))
  const currency = await currencyFor(refunds.map((refund) => refund.store_id))
  return refunds.map((refund) => {
    const total = Number(refund.amount)
    const tax = Number(refund.tax_amount || 0)
    return {
      id: refund.refund_number,
      refund_type: refund.refund_type || "partial",
      location: refs.location(refund.location_id),
      staff: refs.staff(refund.cashier_id),
      order: refs.order(refund.order_id),
      receiptId: refs.number("receipt", refund.receipt_id),
      currency: currency(refund.store_id),
      reason: refund.reason || null,
      items: [...(refund.OrderRefundItems || [])]
        .sort((a, b) => a.item_number - b.item_number)
        .map((line) => ({
          order_item_id: itemNumber.get(line.order_item_id) ?? null,
          ...(line.product_id
            ? { product: { ...(refs.product(line.product_id) || { id: null, sku: null, unit: null }), title: line.title } }
            : { title: line.title }),
          qty: num(line.quantity),
          unit_price: num(line.unit_price),
          amount: num(line.subtotal),
          tax: num(line.tax_amount) ?? 0,
        })),
      amount: Number((total - tax).toFixed(2)),
      tax,
      total,
      // How it was paid back, per method (credit = off the udhaar); older refunds were cash.
      payments: Array.isArray(refund.payments) ? refund.payments : [{ method: "cash", amount: total }],
      refunded_at: refund.created_at,
    }
  })
}

export async function posRefund(refundId) {
  return (await posRefunds([refundId]))[0] || null
}

// ---- Receipts ----

/**
 * A sale receipt (invoice) with the order's full detail: the lines as sold with each tax by
 * source, every payment with its payment GST, and a summary of discounts and taxes.
 * See receiptView.js for the shape.
 */
async function receiptStore(storeId) {
  return Store.findByPk(storeId, { attributes: ["name", "ntn", "strn", "currency"] })
}

/** Udhaar given back by each order's refunds (the credit part of their payments). */
async function creditRefundedByOrder(orderIds) {
  const ids = [...new Set(orderIds.filter(Boolean))]
  if (!ids.length) return new Map()
  const rows = await OrderRefund.findAll({ where: { order_id: { [Op.in]: ids } }, attributes: ["order_id", "payments"] })
  const out = new Map()
  for (const row of rows) {
    const parts = Array.isArray(row.payments) ? row.payments : []
    const credit = parts.filter((part) => part.method === "credit").reduce((sum, part) => sum + Number(part.amount || 0), 0)
    out.set(row.order_id, (out.get(row.order_id) || 0) + credit)
  }
  return out
}

/** Everything a receipt / order detail prints for one order, loaded in a few queries. */
async function receiptContext(order) {
  const items = order?.OrderItems || []
  const [paymentRows, store, refs, credit] = await Promise.all([
    Payment.findAll({
      where: { order_id: order.id },
      attributes: ["id", "transaction_number", "method", "amount", "tax_amount", "status", "paid_at"],
    }),
    receiptStore(order.store_id),
    new Refs().loadAll({
      user: [order.cashier_id],
      location: [order.location_id],
      customer: [order.customer_id],
      batch: [order.register_session_id],
      product: items.map((item) => item.product_id),
    }),
    creditRefundedByOrder([order.id]),
  ])
  await refs.load("category", items.map((item) => item.category_id || refs.get("product", item.product_id)?.category_id))
  const lookups = {
    staff: (id) => refs.staff(id),
    location: (id) => refs.location(id),
    customer: (id) => refs.customer(id),
    product: (id) => {
      const ref = refs.product(id)
      return ref ? { ...ref, category_id: refs.get("product", id)?.category_id } : null
    },
    category: (id) => refs.category(id),
  }
  return { paymentRows, store, refs, lookups, creditRefunded: credit.get(order.id) || 0 }
}

export async function posReceipt(receipt) {
  const order = await Order.findByPk(receipt.order_id, { include: [{ model: OrderItem }] })
  const { paymentRows, store, lookups, creditRefunded } = await receiptContext(order)
  return buildReceiptView({ receipt, order, paymentRows, lookups, store, creditRefunded })
}

/**
 * GET /orders/:id (POS): the receipt's detail (lines with product / category / offer, taxes,
 * payments) plus the staff, batch, transactions (payment rows) and refunds of the order.
 */
export async function posOrderDetail(orderId) {
  const order = await Order.findByPk(orderId, { include: [{ model: OrderItem }] })
  if (!order) return null
  const refunds = await OrderRefund.findAll({ where: { order_id: order.id }, attributes: ["id", "receipt_id"] })
  const receipt = await Receipt.findOne({
    where: {
      order_id: order.id,
      ...(refunds.length ? { id: { [Op.notIn]: refunds.map((row) => row.receipt_id).filter(Boolean) } } : {}),
    },
    order: [["issued_at", "ASC"]],
  })
  const { paymentRows, store, refs, lookups, creditRefunded } = await receiptContext(order)
  const view = buildReceiptView({ receipt, order, paymentRows, lookups, store, creditRefunded })
  return {
    ...view,
    receipt_id: receipt?.receipt_number ?? null,
    staff: refs.staff(order.cashier_id),
    batch: refs.batch(order.register_session_id),
    is_custom: Boolean(order.is_custom),
    offer_exempt: Boolean(order.offer_exempt),
    placed_at: order.placed_at,
    cancel_reason: order.cancel_reason || order.void_reason || null,
    transactions: [...paymentRows]
      .sort((a, b) => Number(a.transaction_number || 0) - Number(b.transaction_number || 0))
      .map((row) => ({
        id: row.transaction_number,
        method: row.method,
        amount: num(row.amount),
        tax_amount: num(row.tax_amount) ?? 0,
        status: row.status,
        paid_at: row.paid_at,
      })),
    refunds: await posRefunds(refunds.map((row) => row.id)),
  }
}

/**
 * GET /orders (POS lists / order history): one short row per order —
 * { id, is_custom, location_name, items, currency, total_amount, status, payment_status,
 *   remaining_amount, placed_at, channel }. GET /orders/:id has the full detail.
 */
export async function posOrderHistory(orderIds) {
  const ids = [...new Set(orderIds.filter(Boolean))]
  if (!ids.length) return []
  const orders = byIds(
    await Order.findAll({
      where: { id: { [Op.in]: ids } },
      include: [{ model: OrderItem, attributes: ["id"] }, { model: Payment, attributes: ["amount", "status"] }],
    }),
    ids
  )
  const [refs, credit] = await Promise.all([
    new Refs().loadAll({ location: orders.map((order) => order.location_id) }),
    creditRefundedByOrder(orders.map((order) => order.id)),
  ])
  const currency = await currencyFor(orders.map((order) => order.store_id))
  return orders.map((order) => ({
    id: order.order_number,
    is_custom: Boolean(order.is_custom),
    location_name: refs.location(order.location_id)?.name || null,
    items: (order.OrderItems || []).length,
    currency: currency(order.store_id),
    total_amount: num(order.total_amount),
    status: order.order_status,
    payment_status: order.payment_status,
    remaining_amount: remainingAmountOf(order, order.Payments, credit.get(order.id) || 0),
    placed_at: order.placed_at,
    channel: order.channel,
  }))
}

export async function posRefundReceipt(refund, receipt) {
  const [lines, order, store, refs] = await Promise.all([
    OrderRefundItem.findAll({ where: { refund_id: refund.id } }),
    Order.findByPk(refund.order_id, { attributes: ["order_number"] }),
    receiptStore(refund.store_id),
    new Refs().loadAll({ user: [refund.cashier_id], location: [receipt.location_id] }),
  ])
  const soldItems = await OrderItem.findAll({
    where: { id: { [Op.in]: lines.map((line) => line.order_item_id).filter(Boolean) } },
    attributes: ["id", "item_number", "sku"],
  })
  return buildRefundReceiptView({
    receipt,
    refund: { ...refund.toJSON(), OrderRefundItems: lines },
    orderNumber: order?.order_number,
    soldItems,
    lookups: { staff: (id) => refs.staff(id), location: (id) => refs.location(id) },
    store,
  })
}

// ---- Stock ----

export async function posStockMovements(movements) {
  const refs = await new Refs().loadAll({
    product: movements.map((row) => row.product_id),
    supplier: movements.map((row) => row.supplier_id),
    user: movements.map((row) => row.staff_id),
    order: movements.map((row) => row.order_id),
    location: movements.map((row) => row.location_id),
  })
  // A variant's product.
  await refs.load("product", movements.map((row) => refs.get("product", row.product_id)?.parent_product_id))
  return movements.map((movement) => ({
    id: movement.movement_number,
    location: refs.location(movement.location_id),
    ...refs.productAndVariant(movement.product_id),
    supplier: refs.supplier(movement.supplier_id),
    staff: refs.staff(movement.staff_id),
    order: refs.order(movement.order_id),
    movement_type: movement.movement_type,
    reason: movement.reason,
    reason_note: movement.reason_note || null,
    qty: num(movement.qty),
    qty_after: num(movement.qty_after),
    unit_sold: num(movement.unit_sold) ?? 0,
    created_at: movement.created_at,
  }))
}

export async function posStockMovement(movement) {
  return (await posStockMovements([movement]))[0]
}

/**
 * Transfers (from publicTransfer(), or rows loaded with their items): the source, and per
 * destination its products with qty / received_qty / status. A transfer with one product also keeps
 * the older flat to_location / product / qty / received_qty.
 */
export async function posTransfers(transfers) {
  const views = transfers.map((row) => (row.destinations ? row : publicTransfer(row)))
  const refs = await new Refs().loadAll({
    location: views.flatMap((view) => [view.from_location_id, ...view.destinations.map((d) => d.to_location_id)]),
    product: views.flatMap((view) => view.destinations.flatMap((d) => d.products.map((p) => p.product_id))),
    user: views.map((view) => view.created_by),
  })
  return views.map((view) => ({
    id: view.transfer_number,
    from_location: refs.location(view.from_location_id),
    status: view.status,
    destinations: view.destinations.map((dest) => ({
      to_location: refs.location(dest.to_location_id),
      status: dest.status,
      products: dest.products.map((line) => ({
        product: refs.product(line.product_id),
        qty: line.qty,
        received_qty: line.received_qty,
        status: line.status,
      })),
    })),
    ...(view.product_id
      ? {
          to_location: refs.location(view.to_location_id),
          product: refs.product(view.product_id),
          qty: view.qty,
          received_qty: view.received_qty,
        }
      : {}),
    note: view.note || null,
    staff: refs.staff(view.created_by),
    created_at: view.created_at,
  }))
}

export async function posTransfer(transfer) {
  return (await posTransfers([transfer]))[0]
}

// ---- Catalog ----

/** From publicSupplier(): location_ids become location numbers, with the locations' names. */
export function posSupplier(view) {
  const locations = (view.locations || []).map((row) => ({ id: row.location_number, name: row.name || null }))
  return {
    id: view.supplier_number,
    location_scope: view.location_scope || (locations.length ? "selected" : "all"),
    locations,
    name: view.name,
    email: view.email || null,
    phone: view.phone || null,
    payment_terms: view.payment_terms || null,
    address: view.address || null,
    is_active: view.is_active,
  }
}

/** Offers (from publicOffer()) with what each one applies to and who added it. */
export async function posOffers(views) {
  const targets = (view) => view.targets || []
  const refs = await new Refs().loadAll({
    product: views.flatMap((view) => targets(view).flatMap((t) => [t.product_id, t.free_product_id])),
    category: views.flatMap((view) => targets(view).map((t) => t.category_id)),
    user: views.map((view) => view.created_by),
  })
  return views.map((view) => {
    const productRows = targets(view).filter((t) => t.product_id)
    return {
      id: view.offer_number,
      type: view.type,
      name: view.name,
      apply_to: view.apply_to,
      // Every product (with its own promo_price / free_product) and every category it applies to.
      products: productRows.map((t) => ({
        ...refs.product(t.product_id),
        promo_price: num(t.promo_price),
        free_product: refs.product(t.free_product_id),
      })),
      categories: targets(view).filter((t) => t.category_id).map((t) => refs.category(t.category_id)),
      discount_type: view.discount_type,
      discount_value: view.discount_value,
      start_at: view.start_at,
      end_at: view.end_at,
      min_qty: view.min_qty,
      buy_qty: view.buy_qty,
      get_qty: view.get_qty,
      location_scope: view.location_scope || "all",
      locations: (view.locations || []).map((row) => ({ id: row.location_number ?? row.id ?? null, name: row.name || null })),
      is_active: view.is_active,
      status: view.is_active ? "active" : "inactive",
      staff: refs.staff(view.created_by),
    }
  })
}

/** One offer; createdBy / targetNumber are kept for older callers (both now come from the view). */
export async function posOffer(view) {
  return (await posOffers([view]))[0]
}

/** location_scope + location_ids: the location numbers, as sent in the request ([] for "all"). */
const posLocationScope = (view) => {
  const ids = (view.locations || []).map((row) => row.location_number).filter((id) => id != null)
  return { location_scope: view.location_scope || (ids.length ? "selected" : "all"), location_ids: ids }
}

/** From publicCategory(): every field, with the short numbers and the parent's name. */
export async function posCategories(views) {
  const refs = await new Refs().load("category", views.map((view) => view.parent_category_id))
  return views.map((view) => ({
    id: view.category_number,
    name: view.name,
    slug: view.slug,
    parent: refs.category(view.parent_category_id),
    image_url: view.image_url || null,
    description: view.description || null,
    tax_type: view.tax_type || null,
    tax_value: num(view.tax_value),
    tax_name: view.tax_name || null,
    discount_type: view.discount_type || null,
    discount_value: num(view.discount_value),
    discount_name: view.discount_name || null,
    ...posLocationScope(view),
    is_active: view.is_active,
  }))
}

export async function posCategory(view) {
  return (await posCategories([view]))[0]
}

/** From publicProduct(): every field, with the short numbers and the category's name. */
export async function posProducts(views) {
  const refs = await new Refs().loadAll({
    category: views.map((view) => view.category_id),
    product: views.map((view) => view.parent_product_id),
  })
  return views.map((view) => ({
    id: view.product_number,
    title: view.title,
    // Variants: a parent (has_variants) lists them; a variant names its parent and its own name.
    has_variants: Boolean(view.has_variants),
    parent: view.parent_product_id ? refs.product(view.parent_product_id) : null,
    variant_name: view.variant_name || null,
    // id = the variant's number inside this product (1, 2, 3…); product_id = its own product number.
    variants: (view.variants || []).map((row) => ({
      id: row.variant_number,
      product_id: row.product_number,
      name: row.name,
      sku: row.sku,
      barcode: row.barcode,
      cost_price: row.cost_price,
      selling_price: row.selling_price,
      is_pack_product: Boolean(row.is_pack_product),
      pack_size: row.pack_size ?? null,
      pack_cost_price: num(row.pack_cost_price),
      pack_selling_price: num(row.pack_selling_price),
      sell_loose: Boolean(row.sell_loose),
      taxes: row.taxes || [],
      ...(row.stocks
        ? {
            qty: num(row.total_qty),
            stocks: row.stocks.map((stock) => ({
              location: { id: stock.location_number, name: stock.location_name || null },
              qty: stock.qty,
              expiry_date: stock.expiry_date,
            })),
          }
        : {}),
      is_active: row.is_active,
    })),
    slug: view.slug,
    category: refs.category(view.category_id),
    sku: view.sku,
    barcode: view.barcode,
    image: view.featured_image || null,
    description: view.description || null,
    unit: view.unit,
    cost_price: num(view.cost_price),
    selling_price: num(view.selling_price),
    has_product_discount: Boolean(view.has_product_discount),
    discount_type: view.discount_type || null,
    discount_value: num(view.discount_value),
    discount_name: view.discount_name || null,
    has_product_tax: (view.taxes || []).length > 0,
    taxes: view.taxes || [],
    is_pack_product: Boolean(view.is_pack_product),
    pack_size: view.pack_size ?? null,
    pack_cost_price: num(view.pack_cost_price),
    pack_selling_price: num(view.pack_selling_price),
    sell_loose: Boolean(view.sell_loose),
    is_weight_based: Boolean(view.is_weight_based),
    has_bulk_discount: Boolean(view.has_bulk_discount),
    low_stock_threshold: num(view.low_stock_threshold),
    total_price_each_unit: num(view.total_price_each_unit),
    total_pack_price: num(view.total_pack_price),
    ...posLocationScope(view),
    // The locations holding its stock: all (every one it is sold at) or selected + their numbers.
    stock_scope: view.stock_scope || "all",
    stock_location_ids: (view.stock_locations || []).map((row) => row.location_number),
    is_active: Boolean(view.is_active),
    is_pos_visible: view.is_pos_visible !== false,
    is_web_visible: view.is_web_visible !== false,
  }))
}

export async function posProduct(view) {
  return (await posProducts([view]))[0]
}
