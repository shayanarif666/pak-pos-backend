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
import { Customer } from "../customers/customer.model.js"
import { ProductStock } from "../catalog/productStock.model.js"
import { StockLot } from "../catalog/stockLot.model.js"
import { Category } from "../catalog/category.model.js"
import { StockMovement } from "../inventory/stockMovement.model.js"
import { StockTransfer } from "../inventory/stockTransfer.model.js"
import { RegisterSession } from "./registerSession.model.js"
import { StaffSession } from "./staffSession.model.js"
import { listCategories } from "../catalog/category.service.js"
import { expiryStatus, listProducts } from "../catalog/product.service.js"
import { Store } from "../stores/store.model.js"
import { categoryOf, figures } from "./saleCatalog.js"
import { listOffers } from "../offers/offer.service.js"
import { listSuppliers } from "../inventory/supplier.service.js"
import { loadLocation } from "../catalog/productStock.service.js"
import { clockStatusOf } from "./staffSession.service.js"
import {
  num,
  numbersOf,
  one,
  posCategories,
  posCustomer,
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
import { StockTransferItem } from "../inventory/stockTransferItem.model.js"
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

// ---- 3. Products: a lean list (the detail, GET /products/:id, has everything else) ----
// { id (product number), title, sku, barcode, category, image, total_variants, price, stock, status }.
// A product with variants: price and stock are null (each variant has its own, in the detail) and
// total_variants is how many it has; without variants: total_variants is null.
export async function products(req) {
  // Every detail of the product, its variants inside, without any stock (that is GET /products/stock).
  const scope = await scopeOf(req)
  const pageInfo = pageOf(req.query)
  const query = { ...req.query }
  const categoryRef = queryRef(req.query, "categoryId", "category_id")
  if (categoryRef) query.category_id = await idOf(Category, "category_number", scope.store_id, categoryRef, "Category")
  delete query.categoryId
  query.location_id = scope.location_id
  const listed = (await listProducts(scope, query, { parentsOnly: true })).filter(inWindow(req.query, (row) => row.created_at))
  const { items, total } = slicePage(listed, pageInfo)
  return paged(await posProducts(items, { role: scope.role, location_id: scope.location_id }), total, pageInfo)
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
    for (const key of ["bill_share", "surcharge_amount", "amount"]) {
      if (row[key] != null) entry[key] = Number(((entry[key] || 0) + row[key]).toFixed(2))
    }
  }
  return [...byMethod.values()]
}

export async function refunds(req) {
  const scope = await scopeOf(req)
  const pageInfo = pageOf(req.query)
  // One list for every refund: partial and complete together, newest first; type = partial | complete narrows it.
  const type = queryRef(req.query, "type")
  if (type && !["complete", "partial", "all"].includes(type)) throw new AppError("type must be complete, partial or all", 400)
  const where = { store_id: scope.store_id, ...atLocation(scope), ...dateRange(req.query, "created_at") }
  if (type === "complete") where.refund_type = "complete"
  else if (type === "partial") where.refund_type = { [Op.or]: ["partial", null] }
  const orderId = await idOf(Order, "order_number", scope.store_id, queryRef(req.query, "orderId", "order_id"), "Order")
  if (orderId) where.order_id = orderId
  // The batch the money left from, and who gave it back.
  const batchId = await idOf(RegisterSession, "session_number", scope.store_id, queryRef(req.query, "batchId", "batch_id"), "Batch")
  if (batchId) where.register_session_id = batchId
  const staffId = await idOf(User, "user_number", scope.store_id, queryRef(req.query, "staffId", "staff_id"), "Staff")
  if (staffId) where.cashier_id = staffId

  // A partial refund is one entry. A complete refund writes one row per order line: one entry per order, its lines added up.
  const found = await OrderRefund.findAll({ where, attributes: ["id", "order_id", "refund_type"], order: [["refund_number", "DESC"]] })
  const groups = []
  const completeOf = new Map()
  for (const row of found) {
    if (row.refund_type !== "complete") {
      groups.push([row.id])
    } else if (completeOf.has(row.order_id)) {
      completeOf.get(row.order_id).push(row.id)
    } else {
      const group = [row.id]
      completeOf.set(row.order_id, group)
      groups.push(group)
    }
  }
  const { items, total } = slicePage(groups, pageInfo)
  // Every refund row of this page in one go, then added up per order (items joined).
  const order = items.flatMap((ids) => [...ids].reverse())
  const shaped = await posRefunds(order) // same order as the ids
  const byUuid = new Map(order.map((id, index) => [id, shaped[index]]))
  const rows = items.map((ids) => {
    const parts = [...ids].reverse().map((id) => byUuid.get(id)).filter(Boolean)
    const entry = { ...parts[0], lines: parts.flatMap((part) => part.lines) }
    for (const part of parts.slice(1)) {
      for (const key of ["amount", "discount_amount", "tax", "surcharge", "total"]) entry[key] = Number(((entry[key] || 0) + (part[key] || 0)).toFixed(2))
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
    // Sent from this location, or with a line going to it.
    const incoming = await StockTransferItem.findAll({
      where: { store_id: scope.store_id, to_location_id: scope.location_id },
      attributes: ["transfer_id"],
    })
    where[Op.or] = [
      { from_location_id: scope.location_id },
      { id: [...new Set(incoming.map((row) => row.transfer_id))] },
    ]
  }
  const status = queryRef(req.query, "status")
  if (status) where.status = status
  const { rows, count } = await StockTransfer.findAndCountAll({
    where,
    include: [{ model: StockTransferItem, as: "items" }],
    distinct: true,
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

// ---- 11. Customers (udhaar) ----
// A customer with no location belongs to every location; one with a location shows there only.
export async function customers(req) {
  const scope = await scopeOf(req)
  const pageInfo = pageOf(req.query)
  const where = { store_id: scope.store_id, ...dateRange(req.query, "created_at") }
  if (scope.location_id) where[Op.and] = [{ [Op.or]: [{ location_id: scope.location_id }, { location_id: null }] }]
  const search = queryRef(req.query, "q")
  if (search) {
    const like = `%${search}%`
    where[Op.or] = [{ name: { [Op.like]: like } }, { phone: { [Op.like]: like } }, { email: { [Op.like]: like } }]
  }
  const { rows, count } = await Customer.findAndCountAll({
    where,
    include: [{ model: Location, attributes: ["id", "name", "location_id_int"] }],
    order: [["customer_number", "ASC"]],
    limit: pageInfo.limit,
    offset: pageInfo.offset,
  })
  return paged(
    rows.map((row) => posCustomer({ ...row.toJSON(), location_number: row.Location?.location_id_int })),
    count,
    pageInfo
  )
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
  const where = { store_id: scope.store_id, role: { [Op.in]: ["manager", "cashier"] }, deleted_at: null, ...atLocation(scope), ...dateRange(req.query, "created_at") }
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
  // A deleted variant's lots are left out (they stay in the database).
  const deletedIds = (await Product.findAll({ where: { store_id: scope.store_id, deleted_at: { [Op.ne]: null } }, attributes: ["id"] })).map((row) => row.id)
  // One row per lot with an expiry date (stock that came in together), soonest first.
  const { rows, count } = await StockLot.findAndCountAll({
    where: { store_id: scope.store_id, expiry_date: { [Op.ne]: null }, deleted_at: null, qty: { [Op.gt]: 0 }, ...atLocation(scope), ...dateRange(req.query, "expiry_date"), ...(deletedIds.length ? { product_id: { [Op.notIn]: deletedIds } } : {}) },
    order: [["expiry_date", "ASC"], ["lot_number", "ASC"]],
    limit: pageInfo.limit,
    offset: pageInfo.offset,
  })
  const products = new Map(
    (
      await Product.findAll({
        where: { id: { [Op.in]: [...new Set(rows.map((row) => row.product_id))] } },
        attributes: ["id", "product_number", "title", "sku", "barcode", "unit", "variant_number", "variant_name"],
        include: [{ model: Product, as: "parent", attributes: ["id", "product_number", "title"] }],
      })
    ).map((row) => [row.id, row])
  )
  const locations = new Map(
    (await Location.findAll({ where: { id: { [Op.in]: [...new Set(rows.map((row) => row.location_id))] } }, attributes: ["id", "location_id_int", "name"] })).map((row) => [row.id, row])
  )
  return paged(
    rows.map((row) => {
      const product = products.get(row.product_id)
      const location = locations.get(row.location_id)
      return {
        // A variant: its product's number and title, and variant { id (number in the product), name }.
        product: product
          ? {
              id: product.parent ? product.parent.product_number : product.product_number,
              title: product.parent ? product.parent.title : product.title,
              sku: product.sku,
              barcode: product.barcode,
              unit: product.unit,
              ...(product.parent ? { variant: { id: product.variant_number, name: product.variant_name } } : {}),
            }
          : null,
        location: location ? { id: location.location_id_int, name: location.name } : { id: row.location_id_int, name: null },
        lot: { id: row.lot_number, received_at: row.received_at },
        qty: num(row.qty),
        expiry_date: row.expiry_date,
        expiry_status: expiryStatus(row.expiry_date, store?.expiry_warning_days, store?.expiry_critical_days),
      }
    }),
    count,
    pageInfo
  )
}

// ---- Products: weight manager (products sold by weight) ----
export async function weightList(req) {
  const scope = await scopeOf(req)
  const pageInfo = pageOf(req.query)
  // The Weight Based Products tab as a short list: one row per product (or variant) sold by weight. A
  // product with variants is not a row itself, its weight variants are. Prices are per ONE unit (kg /
  // gram); stock is at the location read; price_with_tax is what one unit is charged: the price after
  // the product and category discounts, plus every tax (the product's, the Taxes page's, the category's).
  const products = (await listProducts(scope, { location_id: scope.location_id }, { parentsOnly: true })).filter(inWindow(req.query, (row) => row.created_at))
  const refs = await new Refs().loadAll({ category: products.map((view) => view.category_id) })
  const flat = []
  for (const view of products) {
    const category = categoryOf(view, refs)
    const categoryRef = refs.category(view.category_id)
    if (view.has_variants) {
      for (const row of view.variants || []) {
        if (row.is_weight_based) flat.push({ product: view, row, variant: true, category, categoryRef })
      }
    } else if (view.is_weight_based) {
      flat.push({ product: view, row: view, variant: false, category, categoryRef })
    }
  }
  flat.sort((a, b) => a.product.title.localeCompare(b.product.title) || (a.row.variant_number ?? 0) - (b.row.variant_number ?? 0))
  const { items, total } = slicePage(flat, pageInfo)
  const rows = items.map(({ product, row, variant, category, categoryRef }) => {
    const stock = Number(Number(row.total_qty || 0).toFixed(3))
    const pack = Boolean(row.is_pack_product) && Number(row.pack_size) >= 2
    const unit = figures(row, {
      discountRule: variant || !(product.has_product_discount && product.discount_type && product.discount_value != null)
        ? {}
        : { has_product_discount: true, discount_type: product.discount_type, discount_value: product.discount_value, discount_applies_to: product.discount_applies_to || "all", is_weight_based: true },
      category,
      isWeightBased: true,
    })
    const price = row.selling_price == null ? null : Number(row.selling_price)
    return {
      id: product.product_number,
      title: product.title,
      variant: variant ? { id: row.variant_number, name: row.name } : null,
      sku: row.sku,
      category: categoryRef,
      image: (variant ? row.image : null) || product.featured_image || null,
      unit: product.unit,
      price,
      // The cost is for the store admin / manager, not the till.
      cost_price: scope.role === "cashier" || row.cost_price == null ? null : Number(row.cost_price),
      price_with_tax:
        price == null || unit.unit_tax_value == null ? null : Number((price - unit.unit_discount_value + unit.unit_tax_value).toFixed(2)),
      pack: pack ? { size: Number(row.pack_size), price: Number(row.pack_selling_price) } : null,
      stock,
      qty_packs: pack ? Math.floor(stock / Number(row.pack_size)) : null,
      status: row.is_active === false || (!variant && product.is_active === false) ? "inactive" : "active",
    }
  })
  return paged(rows, total, pageInfo)
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

/** Product rows (id = a product UUID): id = the product number; a variant also gets variant_id. */
async function productIds(rows) {
  const ids = rows.map((row) => row.id).filter(isUuid)
  if (!ids.length) return
  const found = await Product.findAll({
    where: { id: { [Op.in]: [...new Set(ids)] } },
    attributes: ["id", "product_number", "variant_number"],
    include: [{ model: Product, as: "parent", attributes: ["id", "product_number"] }],
  })
  const byId = new Map(found.map((row) => [row.id, row]))
  for (const row of rows) {
    if (!isUuid(row.id)) continue
    const product = byId.get(row.id)
    row.id = product ? (product.parent ? product.parent.product_number : product.product_number) : null
    if (product?.parent) row.variant_id = product.variant_number
  }
}

/** POS reply of GET /reports/breakdown: same report, ids as short numbers. */
export async function shortReportIds(report) {
  const rows = (key) => report?.[key]?.rows || []
  await productIds(rows("by_product"))
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
    for (const row of stockRows) row.id = productOf.get(row.id) ?? null
    await productIds(stockRows)
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
