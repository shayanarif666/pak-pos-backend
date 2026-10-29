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
import { buildReceiptView, buildRefundReceiptView } from "./receiptView.js"

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
  product: { model: Product, attributes: ["id", "product_number", "title", "sku", "unit", "category_id"] },
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
  product(id) {
    const row = this.get("product", id)
    return row ? { id: row.product_number, title: row.title, sku: row.sku, unit: row.unit } : null
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
  const orders = byIds(await Order.findAll({ where: { id: { [Op.in]: ids } }, include: [{ model: OrderItem }] }), ids)
  const items = orders.flatMap((order) => order.OrderItems || [])
  const refs = await new Refs().loadAll({
    user: orders.flatMap((order) => [order.cashier_id, order.cancelled_by]),
    customer: orders.map((order) => order.customer_id),
    batch: orders.map((order) => order.register_session_id),
    location: orders.map((order) => order.location_id),
    product: items.map((item) => item.product_id),
  })
  const currency = await currencyFor(orders.map((order) => order.store_id))
  return orders.map((order) => orderView(order, refs, currency(order.store_id)))
}

export async function posOrder(orderId) {
  return (await posOrders([orderId]))[0] || null
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
    return {
      id: item.item_number,
      // The product as sold: the title saved on the line (it may have been renamed since).
      product: { ...(refs.product(item.product_id) || { id: null, sku: null, unit: null }), title: item.title },
      qty: num(item.quantity),
      ...prices,
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

function orderView(order, refs, currency) {
  const items = [...(order.OrderItems || [])].sort((a, b) => a.item_number - b.item_number)
  // subtotal here includes the product and category tax of the lines.
  const subtotal =
    Number(order.subtotal) + Number(order.product_tax_amount || 0) + Number(order.category_tax_amount || 0)
  return {
    id: order.order_number,
    location: refs.location(order.location_id),
    is_custom: Boolean(order.is_custom),
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

export async function posReceipt(receipt) {
  const [order, paymentRows, store] = await Promise.all([
    Order.findByPk(receipt.order_id, { include: [{ model: OrderItem }] }),
    Payment.findAll({
      where: { order_id: receipt.order_id },
      attributes: ["transaction_number", "method", "amount", "status"],
    }),
    receiptStore(receipt.store_id),
  ])
  const refs = await new Refs().loadAll({
    user: [receipt.cashier_id],
    location: [receipt.location_id],
    customer: [order?.customer_id],
  })
  const lookups = {
    staff: (id) => refs.staff(id),
    location: (id) => refs.location(id),
    customer: (id) => refs.customer(id),
  }
  return buildReceiptView({ receipt, order, paymentRows, lookups, store })
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
  return movements.map((movement) => ({
    id: movement.movement_number,
    location: refs.location(movement.location_id),
    product: refs.product(movement.product_id),
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

export async function posTransfers(transfers) {
  const refs = await new Refs().loadAll({
    location: transfers.flatMap((row) => [row.from_location_id, row.to_location_id]),
    product: transfers.map((row) => row.product_id),
    user: transfers.map((row) => row.created_by),
  })
  return transfers.map((transfer) => ({
    id: transfer.transfer_number,
    from_location: refs.location(transfer.from_location_id),
    to_location: refs.location(transfer.to_location_id),
    product: refs.product(transfer.product_id),
    qty: num(transfer.qty),
    received_qty: num(transfer.received_qty),
    status: transfer.status,
    note: transfer.note || null,
    staff: refs.staff(transfer.created_by),
    created_at: transfer.created_at,
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
  const target = (view) => view.targets?.[0] || {}
  const refs = await new Refs().loadAll({
    product: views.flatMap((view) => [target(view).product_id, target(view).free_product_id]),
    category: views.map((view) => target(view).category_id),
    user: views.map((view) => view.created_by),
  })
  return views.map((view) => {
    const t = target(view)
    return {
      id: view.offer_number,
      type: view.type,
      name: view.name,
      apply_to: view.apply_to,
      ...(view.apply_to === "product"
        ? { product: refs.product(t.product_id) }
        : { category: refs.category(t.category_id) }),
      discount_type: view.discount_type,
      discount_value: view.discount_value,
      promo_price: num(t.promo_price),
      free_product: refs.product(t.free_product_id),
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
    is_active: view.is_active,
  }))
}

export async function posCategory(view) {
  return (await posCategories([view]))[0]
}

/** From publicProduct(): every field, with the short numbers and the category's name. */
export async function posProducts(views) {
  const refs = await new Refs().load("category", views.map((view) => view.category_id))
  return views.map((view) => ({
    id: view.product_number,
    title: view.title,
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
    is_active: Boolean(view.is_active),
    is_pos_visible: view.is_pos_visible !== false,
    is_web_visible: view.is_web_visible !== false,
  }))
}

export async function posProduct(view) {
  return (await posProducts([view]))[0]
}
