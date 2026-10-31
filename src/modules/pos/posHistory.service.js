/**
 * POS (channel=pos) GET APIs: the history lists in the same shapes the POST APIs return, with
 * short numbers instead of UUIDs. A store admin sees every location (or one with ?location_id=
 * number or UUID); a manager / cashier only their own location.
 */
import { Op } from "sequelize"
import { Order } from "../orders/order.model.js"
import { OrderRefund } from "../orders/orderRefund.model.js"
import { Receipt } from "../payments/receipt.model.js"
import { Payment } from "../payments/payment.model.js"
import { User } from "../auth/user.model.js"
import { Product } from "../catalog/product.model.js"
import { Location } from "../locations/location.model.js"
import { ProductStock } from "../catalog/productStock.model.js"
import { Category } from "../catalog/category.model.js"
import { StockMovement } from "../inventory/stockMovement.model.js"
import { StockTransfer } from "../inventory/stockTransfer.model.js"
import { RegisterSession } from "./registerSession.model.js"
import { StaffSession } from "./staffSession.model.js"
import { listCategories } from "../catalog/category.service.js"
import { expiryStatus, listProducts, listWeightProducts } from "../catalog/product.service.js"
import { Store } from "../stores/store.model.js"
import { listOffers } from "../offers/offer.service.js"
import { listSuppliers } from "../inventory/supplier.service.js"
import { loadLocation } from "../catalog/productStock.service.js"
import { clockStatusOf } from "./staffSession.service.js"
import {
  currencyOf,
  num,
  numbersOf,
  one,
  posCategories,
  posOffers,
  posOrderDetail,
  posOrderHistory,
  posProducts,
  posReceipt,
  posRefundReceipt,
  posRefunds,
  Refs,
  posStockMovements,
  posSupplier,
  posTransfers,
} from "./posResponses.js"
import { AppError } from "../../shared/errors/AppError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

const isNumber = (ref) => /^\d+$/.test(String(ref ?? "").trim())
const queryRef = (query, ...keys) => {
  for (const key of keys) {
    const value = query[key]
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim()
  }
  return null
}

/** The store and the location the request reads (null = every location, store admin only). */
export async function scopeOf(req) {
  const user = req.user
  const store_id = req.auth?.store_id || user.store_id
  if (user.role !== "store_admin") {
    return { store_id, role: user.role, location_id: req.auth?.location_id || user.location_id }
  }
  const ref = queryRef(req.query, "location_id", "locationId")
  const location_id = ref ? (await loadLocation(store_id, ref)).id : null
  return { store_id, role: user.role, location_id }
}

/** A row reference (short number or UUID) as the row's UUID, or null when not sent. */
async function idOf(model, column, storeId, ref, label) {
  if (!ref) return null
  if (!isNumber(ref)) return ref
  const row = await model.findOne({ where: { store_id: storeId, [column]: Number(ref) }, attributes: ["id"] })
  if (!row) throw new NotFoundError(`${label} not found`)
  return row.id
}

// ?range= presets (from now back): week | month | 6months | year (also 1w, 1m, 6m, 1y).
const RANGE_PRESETS = {
  week: (d) => d.setDate(d.getDate() - 7),
  "1w": (d) => d.setDate(d.getDate() - 7),
  month: (d) => d.setMonth(d.getMonth() - 1),
  "1m": (d) => d.setMonth(d.getMonth() - 1),
  "6months": (d) => d.setMonth(d.getMonth() - 6),
  "6m": (d) => d.setMonth(d.getMonth() - 6),
  year: (d) => d.setFullYear(d.getFullYear() - 1),
  "1y": (d) => d.setFullYear(d.getFullYear() - 1),
}

function parseDay(value, endOfDay) {
  // A plain date (2026-10-25) covers the whole day: from its start, to its end.
  const date = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)
    ? new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`)
    : new Date(value)
  if (Number.isNaN(date.getTime())) throw new AppError(`${endOfDay ? "to" : "from"} must be a date`, 400)
  return date
}

/**
 * The date window of a list: ?range= preset, and / or ?from= & ?to= (dates or date-times).
 * from / to win over the preset; nothing sent = no date filter.
 */
export function dateWindow(query = {}) {
  const preset = queryRef(query, "range")
  let from = null
  let to = null
  if (preset && preset !== "all") {
    const apply = RANGE_PRESETS[preset]
    if (!apply) throw new AppError("range must be week, month, 6months or year", 400)
    from = new Date()
    apply(from)
  }
  const fromRef = queryRef(query, "from")
  const toRef = queryRef(query, "to")
  if (fromRef) from = parseDay(fromRef, false)
  if (toRef) to = parseDay(toRef, true)
  return { from, to }
}

function dateRange(query, column) {
  const { from, to } = dateWindow(query)
  if (!from && !to) return {}
  const range = {}
  if (from) range[Op.gte] = from
  if (to) range[Op.lte] = to
  return { [column]: range }
}

/** In-memory lists (built by other services): keep rows whose date is inside the window. */
function inWindow(query, dateOf) {
  const { from, to } = dateWindow(query)
  if (!from && !to) return () => true
  return (row) => {
    const at = dateOf(row) ? new Date(dateOf(row)) : null
    return Boolean(at) && (!from || at >= from) && (!to || at <= to)
  }
}

const atLocation = (scope) => (scope.location_id ? { location_id: scope.location_id } : {})
const staffOf = (scope, query) =>
  idOf(User, "user_number", scope.store_id, queryRef(query, "staffId", "staff_id"), "Staff member")

// ---- Pagination: ?page (from 1) & limit (1–200, default 20) on every list ----
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 200

export function pageOf(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(query.limit, 10) || DEFAULT_LIMIT))
  return { page, limit, offset: (page - 1) * limit }
}

function paged(rows, total, { page, limit }) {
  return { rows, pagination: { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) } }
}

/** A page of a list already in memory (lists built by the catalog / offer / supplier services). */
function slicePage(list, pageInfo) {
  return { items: list.slice(pageInfo.offset, pageInfo.offset + pageInfo.limit), total: list.length }
}

/** Reply of a paged list: data = the page's rows, pagination next to it. */
export function sendPage(res, result, message = "OK") {
  return res.status(200).json({ success: true, message, data: result.rows, pagination: result.pagination })
}

// ---- 1. User session history (staff attendance) ----
export async function staffSessions(req) {
  const scope = await scopeOf(req)
  const pageInfo = pageOf(req.query)
  const where = { store_id: scope.store_id, ...atLocation(scope), ...dateRange(req.query, "clock_in_at") }
  const staffId = await staffOf(scope, req.query)
  if (staffId) where.user_id = staffId
  const status = queryRef(req.query, "status")
  if (status) where.status = status
  const { rows, count } = await StaffSession.findAndCountAll({
    where,
    order: [["clock_in_at", "DESC"]],
    limit: pageInfo.limit,
    offset: pageInfo.offset,
  })
  const refs = await new Refs().loadAll({ user: rows.map((row) => row.user_id), location: rows.map((row) => row.location_id) })
  return paged(
    rows.map((row) => ({
      id: row.session_number,
      staff: refs.staff(row.user_id),
      location: refs.location(row.location_id),
      status: row.status,
      opening_at: row.clock_in_at,
      closing_at: row.clock_out_at || null,
    })),
    count,
    pageInfo
  )
}

// ---- 2. Categories ----
export async function categories(req) {
  const scope = await scopeOf(req)
  const pageInfo = pageOf(req.query)
  const listed = (await listCategories(scope.store_id, scope, { location_id: scope.location_id })).filter(inWindow(req.query, (row) => row.created_at))
  const { items, total } = slicePage(listed, pageInfo)
  return paged(await posCategories(items), total, pageInfo)
}

// ---- 3. Products (with the stock at the location read) ----
export async function products(req) {
  const scope = await scopeOf(req)
  const pageInfo = pageOf(req.query)
  const query = { ...req.query }
  const categoryRef = queryRef(req.query, "categoryId", "category_id")
  if (categoryRef) query.category_id = await idOf(Category, "category_number", scope.store_id, categoryRef, "Category")
  delete query.categoryId
  query.location_id = scope.location_id
  const listed = (await listProducts(scope, query)).filter(inWindow(req.query, (row) => row.created_at))
  const { items, total } = slicePage(listed, pageInfo)
  const shaped = await posProducts(items)
  const rows = items.map((view, index) => {
    const stocks = view.stocks || []
    return {
      ...shaped[index],
      qty: Number(stocks.reduce((sum, row) => sum + Number(row.qty || 0), 0).toFixed(3)),
      stocks: stocks.map((row) => ({
        location: { id: row.location_number, name: row.location_name || null },
        qty: row.qty,
        expiry_date: row.expiry_date,
      })),
    }
  })
  return paged(rows, total, pageInfo)
}

// ---- 4 / 13. Orders: ?status=completed | pending | cancelled (cancelled + voided) | refunded ----
const ORDER_STATUS = {
  // A sale with some items refunded is still a completed sale (status partial_refunded).
  completed: ["completed", "partial_refunded"],
  partial_refunded: ["partial_refunded"],
  pending: ["pending"],
  cancelled: ["cancelled", "voided"],
  refunded: ["refunded"],
}

export async function orders(req) {
  const scope = await scopeOf(req)
  const pageInfo = pageOf(req.query)
  const where = { store_id: scope.store_id, ...atLocation(scope), ...dateRange(req.query, "placed_at") }
  const status = queryRef(req.query, "status")
  if (status && status !== "all") {
    if (!ORDER_STATUS[status]) throw new AppError("status must be completed, partial_refunded, pending, cancelled, refunded or all", 400)
    where.order_status = { [Op.in]: ORDER_STATUS[status] }
  }
  const staffId = await staffOf(scope, req.query)
  if (staffId) where.cashier_id = staffId
  const batchId = await idOf(RegisterSession, "session_number", scope.store_id, queryRef(req.query, "batchId", "batch_id"), "Batch")
  if (batchId) where.register_session_id = batchId
  const custom = queryRef(req.query, "is_custom")
  if (custom != null) where.is_custom = custom === "true" || custom === "1"
  const { rows, count } = await Order.findAndCountAll({
    where,
    attributes: ["id"],
    order: [
      ["placed_at", "DESC"],
      ["order_number", "DESC"],
    ],
    limit: pageInfo.limit,
    offset: pageInfo.offset,
  })
  return paged(await posOrderHistory(rows.map((row) => row.id)), count, pageInfo)
}

// ---- 5 / 6. Refunds: ?type=complete (whole orders) | partial (some items) ----
// One order's refund rows paid back per method, added up method by method.
function mergeRefundPayments(parts) {
  const byMethod = new Map()
  for (const row of parts.flatMap((part) => part.payments || [])) {
    const entry = byMethod.get(row.method)
    if (!entry) {
      byMethod.set(row.method, { ...row })
      continue
    }
    for (const key of ["bill_share", "payment_tax_amount", "amount"]) {
      if (row[key] != null) entry[key] = Number(((entry[key] || 0) + row[key]).toFixed(2))
    }
  }
  return [...byMethod.values()]
}

export async function refunds(req) {
  const scope = await scopeOf(req)
  const pageInfo = pageOf(req.query)
  const type = queryRef(req.query, "type") || "partial"
  if (!["complete", "partial"].includes(type)) throw new AppError("type must be complete or partial", 400)
  const where = { store_id: scope.store_id, refund_type: type, ...atLocation(scope), ...dateRange(req.query, "created_at") }
  const orderId = await idOf(Order, "order_number", scope.store_id, queryRef(req.query, "orderId", "order_id"), "Order")
  if (orderId) where.order_id = orderId

  if (type === "partial") {
    const { rows, count } = await OrderRefund.findAndCountAll({
      where,
      attributes: ["id"],
      order: [["refund_number", "DESC"]],
      limit: pageInfo.limit,
      offset: pageInfo.offset,
    })
    return paged(await posRefunds(rows.map((row) => row.id)), count, pageInfo)
  }

  // A complete refund writes one row per order line: one entry per order, its lines added up.
  const lines = await OrderRefund.findAll({ where, attributes: ["id", "order_id"], order: [["refund_number", "DESC"]] })
  const byOrder = new Map()
  for (const line of lines) byOrder.set(line.order_id, [...(byOrder.get(line.order_id) || []), line.id])
  const { items, total } = slicePage([...byOrder.values()], pageInfo)
  // Every refund row of this page in one go, then added up per order (items joined).
  const order = items.flatMap((ids) => [...ids].reverse())
  const shaped = await posRefunds(order) // same order as the ids
  const byUuid = new Map(order.map((id, index) => [id, shaped[index]]))
  const rows = items.map((ids) => {
    const parts = [...ids].reverse().map((id) => byUuid.get(id)).filter(Boolean)
    const entry = { ...parts[0], items: parts.flatMap((part) => part.items) }
    for (const part of parts.slice(1)) {
      for (const key of ["amount", "tax", "total"]) entry[key] = Number((entry[key] + part[key]).toFixed(2))
    }
    entry.payments = mergeRefundPayments(parts)
    return entry
  })
  return paged(rows, total, pageInfo)
}

// ---- 7. Stock movements ----
export async function stockMovements(req) {
  const scope = await scopeOf(req)
  const pageInfo = pageOf(req.query)
  const where = { store_id: scope.store_id, ...atLocation(scope), ...dateRange(req.query, "created_at") }
  const productId = await idOf(Product, "product_number", scope.store_id, queryRef(req.query, "productId", "product_id"), "Product")
  if (productId) where.product_id = productId
  const type = queryRef(req.query, "movement_type")
  if (type) where.movement_type = type
  const reason = queryRef(req.query, "reason")
  if (reason) where.reason = reason
  const { rows, count } = await StockMovement.findAndCountAll({
    where,
    order: [
      ["created_at", "DESC"],
      ["movement_number", "DESC"],
    ],
    limit: pageInfo.limit,
    offset: pageInfo.offset,
  })
  return paged(await posStockMovements(rows), count, pageInfo)
}

// ---- 8. Stock transfers (sent from or arriving at the location) ----
export async function stockTransfers(req) {
  const scope = await scopeOf(req)
  const pageInfo = pageOf(req.query)
  const where = { store_id: scope.store_id, ...dateRange(req.query, "created_at") }
  if (scope.location_id) {
    where[Op.or] = [{ from_location_id: scope.location_id }, { to_location_id: scope.location_id }]
  }
  const status = queryRef(req.query, "status")
  if (status) where.status = status
  const { rows, count } = await StockTransfer.findAndCountAll({
    where,
    order: [["created_at", "DESC"]],
    limit: pageInfo.limit,
    offset: pageInfo.offset,
  })
  return paged(await posTransfers(rows), count, pageInfo)
}

// ---- 9. Offers ----
export async function offers(req) {
  const scope = await scopeOf(req)
  const pageInfo = pageOf(req.query)
  const all = await listOffers({ ...scope, id: req.user.id }, { ...req.query, location_id: scope.location_id })
  const { items, total } = slicePage(all.filter(inWindow(req.query, (row) => row.created_at)), pageInfo)
  return paged(await posOffers(items), total, pageInfo)
}

// ---- 10. Suppliers ----
export async function suppliers(req) {
  const scope = await scopeOf(req)
  const pageInfo = pageOf(req.query)
  const all = await listSuppliers(scope.store_id, scope, { ...req.query, location_id: scope.location_id })
  const { items, total } = slicePage(all.filter(inWindow(req.query, (row) => row.created_at)), pageInfo)
  return paged(items.map(posSupplier), total, pageInfo)
}

// ---- 12. Batch history (cash drawer opening / closing) ----
export async function batches(req) {
  const scope = await scopeOf(req)
  const pageInfo = pageOf(req.query)
  const where = { store_id: scope.store_id, ...atLocation(scope), ...dateRange(req.query, "opened_at") }
  const staffId = await staffOf(scope, req.query)
  if (staffId) where.cashier_id = staffId
  const status = queryRef(req.query, "status")
  if (status) where.status = status
  const { rows, count } = await RegisterSession.findAndCountAll({
    where,
    order: [["opened_at", "DESC"]],
    limit: pageInfo.limit,
    offset: pageInfo.offset,
  })
  const refs = await batchRefs(rows)
  return paged(rows.map((row) => batchRow(row, refs)), count, pageInfo)
}

const batchRefs = (rows) =>
  new Refs().loadAll({ user: rows.map((row) => row.cashier_id), location: rows.map((row) => row.location_id) })

function batchRow(row, refs) {
  return {
    id: row.session_number,
    staff: refs.staff(row.cashier_id),
    location: refs.location(row.location_id),
    status: row.status,
    opening_amount: num(row.opening_cash),
    opening_at: row.opened_at,
    cash_sales: num(row.cash_sales),
    card_sales: num(row.card_sales),
    jazzcash_sales: num(row.jazzcash_sales),
    easypaisa_sales: num(row.easypaisa_sales),
    total_sales: num(row.total_sales),
    expected_cash: num(row.expected_cash),
    total_cash: num(row.counted_cash),
    cash_variance: num(row.cash_variance),
    closing_at: row.closed_at || null,
  }
}

/** The open batch of a staff member (?staffId, default the signed-in user) at the location. */
export async function currentBatch(req) {
  const scope = await scopeOf(req)
  const location_id = scope.location_id || req.auth?.location_id || req.user.location_id
  const staffId = (await staffOf(scope, req.query)) || req.user.id
  const row = await RegisterSession.findOne({
    where: { store_id: scope.store_id, location_id, cashier_id: staffId, status: "open" },
    order: [["opened_at", "DESC"]],
  })
  if (!row) return null
  return batchRow(row, await batchRefs([row]))
}

// ---- 14. Staff (managers and cashiers, with whether they are clocked in) ----
export async function staff(req) {
  const scope = await scopeOf(req)
  const pageInfo = pageOf(req.query)
  const where = { store_id: scope.store_id, role: { [Op.in]: ["manager", "cashier"] }, ...atLocation(scope), ...dateRange(req.query, "created_at") }
  const role = queryRef(req.query, "role")
  if (role) where.role = role
  const { rows, count } = await User.findAndCountAll({
    where,
    order: [["user_number", "ASC"]],
    limit: pageInfo.limit,
    offset: pageInfo.offset,
  })
  const [clock, refs] = await Promise.all([
    clockStatusOf(scope.store_id, rows.map((row) => row.id)),
    new Refs().load("location", rows.map((row) => row.location_id)),
  ])
  return paged(
    rows.map((row) => ({
      id: row.user_number,
      location: refs.location(row.location_id),
      name: row.name,
      email: row.email,
      pin: row.pin || null,
      role: row.role,
      phone: row.phone || null,
      status: clock.get(row.id) || "clock_out",
      is_active: Boolean(row.is_active),
    })),
    count,
    pageInfo
  )
}

// ---- 16. Transactions (one per order payment) ----
export async function transactions(req) {
  const scope = await scopeOf(req)
  const pageInfo = pageOf(req.query)
  const where = { store_id: scope.store_id, ...atLocation(scope), ...dateRange(req.query, "created_at") }
  const orderId = await idOf(Order, "order_number", scope.store_id, queryRef(req.query, "orderId", "order_id"), "Order")
  if (orderId) where.order_id = orderId
  for (const key of ["method", "status"]) {
    const value = queryRef(req.query, key)
    if (value) where[key] = value
  }
  const { rows, count } = await Payment.findAndCountAll({
    where,
    order: [
      ["created_at", "DESC"],
      ["transaction_number", "DESC"],
    ],
    limit: pageInfo.limit,
    offset: pageInfo.offset,
  })
  const refs = await new Refs().loadAll({ order: rows.map((row) => row.order_id), location: rows.map((row) => row.location_id) })
  return paged(
    rows.map((row) => ({
      id: row.transaction_number,
      // The till's card / wallet reference, when it sent one.
      reference: row.gateway_transaction_id || null,
      order: refs.order(row.order_id),
      location: refs.location(row.location_id),
      method: row.method,
      amount: num(row.amount),
      tax_amount: num(row.tax_amount),
      currency: row.currency,
      status: row.status,
      paid_at: row.paid_at,
    })),
    count,
    pageInfo
  )
}

// ---- Products: expiry manager (stock rows with an expiry date, soonest first) ----
export async function expiryList(req) {
  const scope = await scopeOf(req)
  const pageInfo = pageOf(req.query)
  const store = await Store.findByPk(scope.store_id, { attributes: ["expiry_warning_days", "expiry_critical_days"] })
  const { rows, count } = await ProductStock.findAndCountAll({
    where: { store_id: scope.store_id, expiry_date: { [Op.ne]: null }, ...atLocation(scope), ...dateRange(req.query, "expiry_date") },
    include: [
      { model: Product, attributes: ["product_number", "title", "sku", "barcode", "unit"], required: true },
      { model: Location, attributes: ["location_id_int", "name"] },
    ],
    order: [["expiry_date", "ASC"]],
    limit: pageInfo.limit,
    offset: pageInfo.offset,
  })
  return paged(
    rows.map((row) => ({
      product: {
        id: row.Product.product_number,
        title: row.Product.title,
        sku: row.Product.sku,
        barcode: row.Product.barcode,
        unit: row.Product.unit,
      },
      location: row.Location ? { id: row.Location.location_id_int, name: row.Location.name } : { id: row.location_id_int, name: null },
      qty: num(row.qty),
      expiry_date: row.expiry_date,
      expiry_status: expiryStatus(row.expiry_date, store?.expiry_warning_days, store?.expiry_critical_days),
    })),
    count,
    pageInfo
  )
}

// ---- Products: weight manager (products sold by weight) ----
export async function weightList(req) {
  const scope = await scopeOf(req)
  const pageInfo = pageOf(req.query)
  const listed = (await listWeightProducts(scope.store_id)).filter(inWindow(req.query, (row) => row.created_at))
  const { items, total } = slicePage(listed, pageInfo)
  return paged(await posProducts(items), total, pageInfo)
}

// ---- Orders: one order by its number (or UUID) ----
export async function orderDetail(req, ref) {
  const scope = await scopeOf(req)
  const orderId = await idOf(Order, "order_number", scope.store_id, ref, "Order")
  const order = await Order.findOne({ where: { id: orderId, store_id: scope.store_id }, attributes: ["id", "location_id"] })
  if (!order) throw new NotFoundError("Order not found")
  assertAtScope(scope, order, "Order")
  return posOrderDetail(order.id)
}

function assertAtScope(scope, row, label) {
  if (scope.role !== "store_admin" && row.location_id && row.location_id !== scope.location_id) {
    throw new NotFoundError(`${label} not found`)
  }
}

// ---- 17. Receipt by order id (the sale receipt) ----
export async function orderReceipt(req, ref) {
  const scope = await scopeOf(req)
  const orderId = await idOf(Order, "order_number", scope.store_id, ref, "Order")
  const order = await Order.findOne({ where: { id: orderId, store_id: scope.store_id } })
  if (!order) throw new NotFoundError("Order not found")
  assertAtScope(scope, order, "Order")
  // Refunds also write receipts for the order; the sale receipt is the one no refund points at.
  const refundReceipts = (
    await OrderRefund.findAll({ where: { order_id: order.id }, attributes: ["receipt_id"] })
  ).map((row) => row.receipt_id)
  const receipt = await Receipt.findOne({
    where: { order_id: order.id, ...(refundReceipts.length ? { id: { [Op.notIn]: refundReceipts } } : {}) },
    order: [["issued_at", "ASC"]],
  })
  if (!receipt) throw new NotFoundError("Receipt not found")
  // posReceipt carries the store currency.
  return posReceipt(receipt)
}

// ---- 18. Receipt by refund id ----
export async function refundReceipt(req, ref) {
  const scope = await scopeOf(req)
  const refundId = await idOf(OrderRefund, "refund_number", scope.store_id, ref, "Refund")
  const refund = await OrderRefund.findOne({ where: { id: refundId, store_id: scope.store_id } })
  if (!refund) throw new NotFoundError("Refund not found")
  assertAtScope(scope, refund, "Refund")
  const receipt = refund.receipt_id ? await Receipt.findByPk(refund.receipt_id) : null
  if (!receipt) throw new NotFoundError("Refund receipt not found")
  return posRefundReceipt(refund, receipt)
}

// ---- 11. Detailed reporting: the report rows' UUIDs as the POS's short numbers ----
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value))

async function renumber(rows, model, column, idOfRow = (row) => row.id) {
  const ids = rows.map(idOfRow).filter(isUuid)
  const numbers = await numbersOf(model, column, ids)
  for (const row of rows) {
    const id = idOfRow(row)
    if (isUuid(id)) row.id = numbers.get(id) ?? null
  }
}

/** POS reply of GET /reports/breakdown: same report, ids as short numbers. */
export async function shortReportIds(report) {
  const rows = (key) => report?.[key]?.rows || []
  await renumber(rows("by_product"), Product, "product_number")
  await renumber(rows("by_cashier"), User, "user_number")
  await renumber(rows("stock_movement"), StockMovement, "movement_number")
  await renumber(rows("z_reports"), RegisterSession, "session_number")
  for (const row of rows("z_reports")) row.session_id = row.id
  // Inventory rows are stock rows (one per product and location): show the product number.
  const stockRows = rows("inventory").filter((row) => isUuid(row.id))
  if (stockRows.length) {
    const stocks = await ProductStock.findAll({
      where: { id: { [Op.in]: stockRows.map((row) => row.id) } },
      attributes: ["id", "product_id"],
    })
    const productOf = new Map(stocks.map((row) => [row.id, row.product_id]))
    const numbers = await numbersOf(Product, "product_number", [...productOf.values()])
    for (const row of stockRows) row.id = numbers.get(productOf.get(row.id)) ?? null
  }
  // Refund / void rows: "refund" ids are refunds, "voided:<order>" / "cancelled:<order>" orders.
  const refundRows = rows("refund_void")
  await renumber(refundRows.filter((row) => row.type === "refund"), OrderRefund, "refund_number")
  const orderRows = refundRows.filter((row) => row.type !== "refund")
  for (const row of orderRows) row.id = String(row.id).split(":").pop()
  await renumber(orderRows, Order, "order_number")
  return report
}

// ---- 15. Tax-rate: the rates without their internal UUIDs ----
export function posTaxRates(data) {
  return {
    ...data,
    sales_tax_rate: num(data.sales_tax_rate),
    rates: (data.rates || []).map((rate) => ({ payment_method: rate.payment_method, gst_percent: num(rate.gst_percent) })),
  }
}

// ---- Store profile / locations: the view with its short number as id and no UUID fields ----
const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function withoutUuids(value) {
  if (Array.isArray(value)) return value.map(withoutUuids)
  if (!value || typeof value !== "object" || value instanceof Date) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => !(typeof v === "string" && UUID_VALUE.test(v)))
      .map(([k, v]) => [k, withoutUuids(v)])
  )
}

/** POS shape of a view whose short number is in numberKey (store_number, location_number...). */
export function posView(view, numberKey) {
  const json = view?.toJSON ? view.toJSON() : view
  if (!json) return json
  const { [numberKey]: number, ...rest } = withoutUuids(json)
  return { id: number ?? null, ...rest }
}
