import { Op, fn, col } from "sequelize"
import { Order } from "../orders/order.model.js"
import { OrderItem } from "../orders/orderItem.model.js"
import { Product } from "../catalog/product.model.js"
import { ProductStock } from "../catalog/productStock.model.js"
import { StockMovement } from "../inventory/stockMovement.model.js"
import { Supplier } from "../inventory/supplier.model.js"
import { SupplierLedger } from "../inventory/supplierLedger.model.js"
import { Customer } from "../customers/customer.model.js"
import { StaffSession } from "../pos/staffSession.model.js"
import { Location } from "../locations/location.model.js"
import { User } from "../auth/user.model.js"
import { Plan } from "../plans/plan.model.js"
import { getStoreForManager } from "../stores/store.service.js"
import { loadLocation } from "../catalog/productStock.service.js"
import { money } from "../commerce/pricing.service.js"
import { reportParts as parts } from "../orders/reports.pos.service.js"
import { dateBound, normalizeChannel, reportScope } from "../orders/reports.service.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"

/*
 * GET /api/v1/reporting — the dashboard's reporting, by the store plan's reporting_level.
 * Every card belongs to a level; a plan sees its level and the ones below it, the rest come back
 * locked. One card is worked out per request (only for the chosen dates and location) and every
 * list in it is paged, so the browser never loads the whole history at once.
 */

const LEVELS = ["basic", "standard", "advanced"]
const levelRank = (level) => LEVELS.indexOf(level)
// Basic shows the top 10 products / categories; Standard and Advanced every one.
const BASIC_TOP = 10
const DEFAULT_DAYS = 7
const MAX_LIMIT = 200

export const CARDS = [
  // Basic
  { id: "sales", label: "Sales Summary", level: "basic", about: "Orders, gross and net sales, discounts, taxes and the sales trend." },
  { id: "payments", label: "Payments", level: "basic", about: "Takings per payment method, payment tax and refunds." },
  { id: "batches", label: "Z-Reports (Batches)", level: "basic", about: "Each batch: takings per method, expected vs counted cash." },
  { id: "top_products", label: "Top Products", level: "basic", about: "Best-selling products by sales (Basic: top 10; Standard and up: every product)." },
  { id: "top_categories", label: "Top Categories", level: "basic", about: "Best-selling categories by sales (Basic: top 10; Standard and up: every category)." },
  { id: "refunds", label: "Refunded Orders", level: "basic", about: "Complete and partial refunds with amounts and reasons." },
  { id: "cancelled", label: "Cancelled Orders", level: "basic", about: "Voided and cancelled sales and the sales lost." },
  // Standard
  { id: "locations", label: "By Location", level: "standard", about: "How much each location sold, its taxes, refunds and share.", allOnly: true },
  { id: "inventory", label: "Inventory", level: "standard", about: "Stock on hand with what came in and went out in the range." },
  { id: "movements", label: "Stock Movements", level: "standard", about: "Every stock in / out with its location, reason and who did it." },
  { id: "transfers", label: "Stock Transfers", level: "standard", about: "Stock sent between locations: what left, what arrived and what is on the way." },
  { id: "discounts", label: "Discounts", level: "standard", about: "Every discount entered and each discounted sale with its calculation." },
  { id: "cashiers", label: "By Cashier", level: "standard", about: "Orders, sales, discounts and refunds per staff member." },
  { id: "sessions", label: "Sessions History", level: "standard", about: "Staff clock in / clock out and hours worked." },
  // Advanced
  { id: "profit", label: "Profit & Margin", level: "advanced", about: "Cost, gross profit and margin % by product, category and location." },
  { id: "tax", label: "Tax Breakdown", level: "advanced", about: "Sales, product, category and payment-method tax collected." },
  { id: "comparison", label: "Period Comparison", level: "advanced", about: "These dates against the same number of days just before, with the change." },
  { id: "offers", label: "Offer Performance", level: "advanced", about: "Sales, units, free units and discount given per offer." },
  { id: "dead_stock", label: "Dead Stock", level: "advanced", about: "Products in stock that did not sell in these dates, with when they last sold." },
  { id: "forecast", label: "Stock Forecast", level: "advanced", about: "Days until each product runs out, from its average daily sales." },
  { id: "peak_hours", label: "Peak Hours", level: "advanced", about: "Orders and sales by hour and weekday, for staffing." },
  { id: "customers", label: "Customers", level: "advanced", about: "Top customers, repeat buyers and udhaar still owed." },
  { id: "suppliers", label: "Suppliers", level: "advanced", about: "Purchases and returns per supplier and the ledger balance." },
  { id: "variance", label: "Variance & Losses", level: "advanced", about: "Batches with a cash shortage or excess, and damage / theft / expiry / waste." },
]
const CARD = new Map(CARDS.map((card) => [card.id, card]))

/** The store plan's reporting level (custom counts as advanced until custom cards exist). */
async function planLevel(store) {
  const plan = store.plan_id ? await Plan.findByPk(store.plan_id, { attributes: ["id", "name", "code", "reporting_level"] }) : null
  const raw = plan?.reporting_level || "basic"
  return { level: raw === "custom" ? "advanced" : LEVELS.includes(raw) ? raw : "basic", plan }
}

const ymd = (date) => date.toISOString().slice(0, 10)

/** from / to (YYYY-MM-DD); left out = the last 7 days. */
function dateRange(query) {
  const today = new Date()
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(query.to || "")) ? String(query.to) : ymd(today)
  const fallbackFrom = new Date(`${to}T00:00:00Z`)
  fallbackFrom.setUTCDate(fallbackFrom.getUTCDate() - (DEFAULT_DAYS - 1))
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(query.from || "")) ? String(query.from) : ymd(fallbackFrom)
  if (from > to) throw new AppError("from must be on or before to", 400)
  const days = Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1
  return { from, to, days }
}

/**
 * location: a location number or UUID, or "all" (store admin only). A manager always gets their
 * own location. Returns { location (row or null), actorQuery } for the report builders.
 */
async function resolveLocation(actor, query) {
  const raw = String(query.location ?? query.location_id ?? query.locationId ?? "").trim()
  if (actor.role !== "store_admin") {
    if (!actor.location_id) throw new ForbiddenError("No location on this account")
    const own = await loadLocation(actor.store_id, actor.location_id)
    if (raw && raw !== "all" && raw !== String(own.location_id_int) && raw !== own.id) {
      throw new ForbiddenError("You can only see the reports of your own location")
    }
    return own
  }
  if (!raw || raw === "all") return null
  return loadLocation(actor.store_id, raw)
}

/** One page of a list: ?table= picks the list the page is for; the others start at page 1. */
function pageOf(rows, { page, limit, search }) {
  let list = rows || []
  if (search) {
    const needle = search.toLowerCase()
    list = list.filter((row) => JSON.stringify(row).toLowerCase().includes(needle))
  }
  const total = list.length
  if (limit === "all") return { rows: list, pagination: { page: 1, limit: total, total, total_pages: 1 } }
  const total_pages = Math.max(1, Math.ceil(total / limit))
  const current = Math.min(Math.max(1, page), total_pages)
  return { rows: list.slice((current - 1) * limit, current * limit), pagination: { page: current, limit, total, total_pages } }
}

// Computed sections are kept for a minute, so paging through a card does not work it out again.
const cache = new Map()
const CACHE_MS = 60 * 1000
async function cached(key, build) {
  const hit = cache.get(key)
  if (hit && hit.at > Date.now() - CACHE_MS) return hit.value
  const value = await build()
  cache.set(key, { at: Date.now(), value })
  if (cache.size > 100) cache.delete(cache.keys().next().value)
  return value
}

const sum = (rows, key) => money(rows.reduce((total, row) => total + Number(row[key] || 0), 0))
const pct = (part, whole) => (Number(whole) ? money((Number(part) / Number(whole)) * 100) : 0)

// ---------- advanced sections ----------

/** Profit & margin per product, category and location, from the lines kept after refunds. */
function profitSection(completed) {
  const groups = { product: new Map(), category: new Map(), location: new Map() }
  const add = (map, key, base, line) => {
    if (!map.has(key)) map.set(key, { ...base, units: 0, net_sales: 0, cost: 0, gross_profit: 0, margin_percent: 0 })
    const row = map.get(key)
    row.units = money(row.units + line.units)
    row.net_sales = money(row.net_sales + line.net)
    row.cost = money(row.cost + line.cost)
  }
  for (const { order, figures } of completed) {
    for (const line of figures.lines) {
      if (line.units <= 0) continue
      const { item } = line
      const category = item.Product?.Category?.name || item.custom_category || (item.product_id ? "Uncategorized" : "Custom")
      add(groups.product, item.product_id || `custom:${item.title}`, { product: item.Product?.title || item.title, category }, line)
      add(groups.category, category, { category }, line)
      add(groups.location, order.location_id || "none", { location: order.Location?.name || "—" }, line)
    }
  }
  const finish = (map) =>
    [...map.values()]
      .map((row) => ({ ...row, gross_profit: money(row.net_sales - row.cost), margin_percent: pct(row.net_sales - row.cost, row.net_sales) }))
      .sort((a, b) => b.gross_profit - a.gross_profit)
  const byProduct = finish(groups.product)
  const net = sum(byProduct, "net_sales")
  const cost = sum(byProduct, "cost")
  return {
    summary: { net_sales: net, cost, gross_profit: money(net - cost), margin_percent: pct(net - cost, net) },
    tables: { by_product: byProduct, by_category: finish(groups.category), by_location: finish(groups.location) },
  }
}

const COMPARE_KEYS = [
  ["orders", "Orders"],
  ["units_sold", "Units sold"],
  ["gross_sales", "Gross sales"],
  ["discounts", "Discounts"],
  ["net_sales", "Net sales"],
  ["tax", "Tax"],
  ["total_sales", "Total sales"],
  ["refunds", "Refunds"],
  ["avg_order_value", "Average order"],
  ["gross_profit", "Gross profit"],
]

async function salesTotals(actor, query) {
  const orders = await parts.loadOrders(actor, query)
  const extras = parts.liveOrders(orders)
  return parts.salesSummary(extras.completed, extras, query).totals
}

/** These dates vs the same number of days right before them. */
async function comparisonSection(actor, query, range) {
  const prevTo = new Date(`${range.from}T00:00:00Z`)
  prevTo.setUTCDate(prevTo.getUTCDate() - 1)
  const prevFrom = new Date(prevTo)
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (range.days - 1))
  const previous = { from: ymd(prevFrom), to: ymd(prevTo) }
  const [now, before] = await Promise.all([
    salesTotals(actor, query),
    salesTotals(actor, { ...query, from: previous.from, to: previous.to }),
  ])
  const rows = COMPARE_KEYS.map(([key, metric]) => {
    const current = Number(now[key] || 0)
    const prior = Number(before[key] || 0)
    return {
      metric,
      current: money(current),
      previous: money(prior),
      change: money(current - prior),
      change_percent: prior ? money(((current - prior) / Math.abs(prior)) * 100) : current ? 100 : 0,
    }
  })
  return { summary: { current_from: range.from, current_to: range.to, previous_from: previous.from, previous_to: previous.to }, tables: { rows } }
}

/** Sellable products (no variant parents) with their stock rows in the scope. */
async function stockRows(actor, location) {
  const where = { store_id: actor.store_id }
  if (location) where.location_id = location.id
  return ProductStock.findAll({
    where,
    include: [
      { model: Product, attributes: ["id", "title", "sku", "barcode", "has_variants", "variant_name", "is_active", "parent_product_id"], where: { has_variants: false } },
      { model: Location, attributes: ["id", "name"] },
    ],
  })
}

/** Units sold per product in the range (kept after refunds). */
function unitsSold(completed) {
  const units = new Map()
  for (const { figures } of completed) {
    for (const line of figures.lines) {
      if (!line.item.product_id || line.units <= 0) continue
      units.set(line.item.product_id, money((units.get(line.item.product_id) || 0) + line.units))
    }
  }
  return units
}

const productName = (product) => (product?.variant_name ? `${product.title} · ${product.variant_name}` : product?.title || "—")

/** In stock but not sold in the range, with the last sale ever (up to `to`). */
async function deadStockSection(actor, location, completed, range) {
  const sold = unitsSold(completed)
  const stocks = (await stockRows(actor, location)).filter((row) => Number(row.qty) > 0 && !sold.has(row.product_id))
  const ids = [...new Set(stocks.map((row) => row.product_id))]
  const lastSold = new Map()
  if (ids.length) {
    const orderWhere = { store_id: actor.store_id, order_status: { [Op.notIn]: ["voided", "cancelled"] }, placed_at: { [Op.lte]: dateBound(range.to, true) } }
    if (location) orderWhere.location_id = location.id
    const rows = await OrderItem.findAll({
      attributes: ["product_id", [fn("MAX", col("Order.placed_at")), "last_sold_at"]],
      where: { product_id: { [Op.in]: ids } },
      include: [{ model: Order, attributes: [], where: orderWhere }],
      group: ["product_id"],
      raw: true,
    })
    for (const row of rows) lastSold.set(row.product_id, row.last_sold_at)
  }
  const end = dateBound(range.to, true)
  const rows = stocks
    .map((row) => {
      const last = lastSold.get(row.product_id) || null
      return {
        product: productName(row.Product),
        sku: row.Product?.sku || null,
        location: row.Location?.name || "—",
        stock: Number(row.qty),
        last_sold_at: last,
        days_since_sale: last ? Math.floor((end - new Date(last)) / 86400000) : null,
      }
    })
    .sort((a, b) => (b.days_since_sale ?? 1e9) - (a.days_since_sale ?? 1e9))
  return { summary: { products: rows.length, units_in_stock: sum(rows, "stock"), never_sold: rows.filter((row) => !row.last_sold_at).length }, tables: { rows } }
}

/** Days left of stock at the range's average daily sale. */
async function forecastSection(actor, location, completed, range) {
  const sold = unitsSold(completed)
  const byProduct = new Map()
  for (const row of await stockRows(actor, location)) {
    if (!byProduct.has(row.product_id)) byProduct.set(row.product_id, { product: productName(row.Product), sku: row.Product?.sku || null, stock: 0 })
    byProduct.get(row.product_id).stock = money(byProduct.get(row.product_id).stock + Number(row.qty || 0))
  }
  const rows = [...byProduct.entries()]
    .map(([id, row]) => {
      const units = sold.get(id) || 0
      const daily = money(units / range.days)
      const days_left = daily > 0 ? Math.floor(row.stock / daily) : null
      const status = row.stock <= 0 ? "out" : days_left == null ? "no_sales" : days_left <= 7 ? "critical" : days_left <= 14 ? "low" : "ok"
      return { ...row, units_sold: units, avg_daily_sales: daily, days_left, status }
    })
    .sort((a, b) => (a.days_left ?? 1e9) - (b.days_left ?? 1e9))
  return {
    summary: {
      products: rows.length,
      out_of_stock: rows.filter((row) => row.status === "out").length,
      critical_7_days: rows.filter((row) => row.status === "critical").length,
      low_14_days: rows.filter((row) => row.status === "low").length,
    },
    tables: { rows },
  }
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/** Orders and sales by hour (0–23) and weekday, in the store's time zone. */
function peakHoursSection(completed, timeZone) {
  const format = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", hourCycle: "h23" })
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour: `${String(hour).padStart(2, "0")}:00`,
    ...Object.fromEntries(WEEKDAYS.map((day) => [day, 0])),
    orders: 0,
    sales: 0,
  }))
  const days = WEEKDAYS.map((day) => ({ weekday: day, orders: 0, sales: 0 }))
  for (const { order, figures } of completed) {
    if (figures.fully_refunded) continue
    const partsOf = Object.fromEntries(format.formatToParts(new Date(order.placed_at)).map((part) => [part.type, part.value]))
    const hour = Number(partsOf.hour) % 24
    const day = WEEKDAYS.indexOf(partsOf.weekday)
    const row = hours[hour]
    row[WEEKDAYS[day]] += 1
    row.orders += 1
    row.sales = money(row.sales + figures.total)
    days[day].orders += 1
    days[day].sales = money(days[day].sales + figures.total)
  }
  const busiest = [...hours].sort((a, b) => b.orders - a.orders)[0]
  const busiestDay = [...days].sort((a, b) => b.orders - a.orders)[0]
  return {
    summary: { busiest_hour: busiest?.orders ? busiest.hour : null, busiest_day: busiestDay?.orders ? busiestDay.weekday : null },
    tables: { by_hour: hours, by_weekday: days },
  }
}

/** Customers who bought in the range, repeat buyers, and udhaar owed. */
async function customersSection(actor, location, completed) {
  const groups = new Map()
  for (const { order, figures } of completed) {
    if (!order.customer_id) continue
    if (!groups.has(order.customer_id)) groups.set(order.customer_id, { orders: 0, total_spent: 0, refunds: 0, last_order_at: null })
    const row = groups.get(order.customer_id)
    row.orders += 1
    row.total_spent = money(row.total_spent + figures.total)
    row.refunds = money(row.refunds + figures.refunded)
    if (!row.last_order_at || new Date(order.placed_at) > new Date(row.last_order_at)) row.last_order_at = order.placed_at
  }
  const debtWhere = { store_id: actor.store_id, remaining_debt: { [Op.gt]: 0 } }
  if (location) debtWhere.location_id = location.id
  const [buyers, debtors] = await Promise.all([
    groups.size ? Customer.findAll({ where: { id: { [Op.in]: [...groups.keys()] } }, attributes: ["id", "customer_number", "name", "phone", "remaining_debt"] }) : [],
    Customer.findAll({ where: debtWhere, attributes: ["id", "customer_number", "name", "phone", "total_debt", "remaining_debt"], order: [["remaining_debt", "DESC"]] }),
  ])
  const top = buyers
    .map((customer) => ({
      customer: customer.name,
      customer_number: customer.customer_number,
      phone: customer.phone,
      ...groups.get(customer.id),
      repeat: groups.get(customer.id).orders > 1,
      udhaar_owed: money(customer.remaining_debt || 0),
    }))
    .sort((a, b) => b.total_spent - a.total_spent)
  const udhaar = debtors.map((customer) => ({
    customer: customer.name,
    customer_number: customer.customer_number,
    phone: customer.phone,
    total_debt: money(customer.total_debt || 0),
    remaining_debt: money(customer.remaining_debt || 0),
  }))
  return {
    summary: {
      customers: top.length,
      repeat_customers: top.filter((row) => row.repeat).length,
      sales_to_customers: sum(top, "total_spent"),
      udhaar_owed: sum(udhaar, "remaining_debt"),
    },
    tables: { top_customers: top, udhaar },
  }
}

/** Purchases / returns per supplier in the range (stock movements) and the ledger. */
async function suppliersSection(actor, location, range) {
  const created = { [Op.gte]: dateBound(range.from), [Op.lte]: dateBound(range.to, true) }
  const moveWhere = { store_id: actor.store_id, supplier_id: { [Op.ne]: null }, created_at: created }
  const ledgerWhere = { store_id: actor.store_id }
  if (location) {
    moveWhere.location_id = location.id
    ledgerWhere.location_id = location.id
  }
  const [moves, ledger, suppliers] = await Promise.all([
    StockMovement.findAll({ where: moveWhere, attributes: ["supplier_id", "movement_type", "reason", "qty"] }),
    SupplierLedger.findAll({ where: ledgerWhere, attributes: ["supplier_id", "entry_type", "amount", "created_at"] }),
    Supplier.findAll({ where: { store_id: actor.store_id }, attributes: ["id", "supplier_number", "name", "phone"] }),
  ])
  const rows = new Map(
    suppliers.map((supplier) => [
      supplier.id,
      { supplier: supplier.name, supplier_number: supplier.supplier_number, phone: supplier.phone, purchases: 0, units_received: 0, returns: 0, units_returned: 0, billed_in_range: 0, paid_in_range: 0, balance: 0 },
    ])
  )
  for (const move of moves) {
    const row = rows.get(move.supplier_id)
    if (!row) continue
    const qty = Math.abs(Number(move.qty || 0))
    if (move.reason === "return_to_supplier") {
      row.returns += 1
      row.units_returned = money(row.units_returned + qty)
    } else if (Number(move.qty) > 0) {
      row.purchases += 1
      row.units_received = money(row.units_received + qty)
    }
  }
  const from = dateBound(range.from)
  const to = dateBound(range.to, true)
  for (const entry of ledger) {
    const row = rows.get(entry.supplier_id)
    if (!row) continue
    const amount = Number(entry.amount || 0)
    const inRange = new Date(entry.created_at) >= from && new Date(entry.created_at) <= to
    // Debit = a purchase the store owes; credit = a payment to the supplier.
    if (entry.entry_type === "debit") {
      row.balance = money(row.balance + amount)
      if (inRange) row.billed_in_range = money(row.billed_in_range + amount)
    } else {
      row.balance = money(row.balance - amount)
      if (inRange) row.paid_in_range = money(row.paid_in_range + amount)
    }
  }
  const list = [...rows.values()]
    .filter((row) => row.purchases || row.returns || row.balance || row.billed_in_range || row.paid_in_range)
    .sort((a, b) => b.units_received - a.units_received)
  return {
    summary: { suppliers: list.length, units_received: sum(list, "units_received"), units_returned: sum(list, "units_returned"), balance_owed: sum(list, "balance") },
    tables: { rows: list },
  }
}

const LOSS_REASONS = ["damage", "theft", "expiry", "waste"]

/** Batches whose counted cash differs from expected, and stock lost. */
async function varianceSection(actor, scopedQuery, scope, location, range) {
  const batches = (await parts.zReports(actor, scopedQuery, scope)).rows.filter((row) => row.status === "CLOSED" && Number(row.variance) !== 0)
  const where = { store_id: actor.store_id, reason: { [Op.in]: LOSS_REASONS }, created_at: { [Op.gte]: dateBound(range.from), [Op.lte]: dateBound(range.to, true) } }
  if (location) where.location_id = location.id
  const moves = await StockMovement.findAll({
    where,
    include: [
      { model: Product, attributes: ["id", "title", "variant_name", "cost_price"] },
      { model: Location, attributes: ["id", "name"] },
    ],
    order: [["created_at", "DESC"]],
  })
  const staffIds = [...new Set(moves.map((move) => move.staff_id).filter(Boolean))]
  const staff = new Map((staffIds.length ? await User.findAll({ where: { id: staffIds }, attributes: ["id", "name"] }) : []).map((row) => [row.id, row.name]))
  const losses = moves.map((move) => {
    const units = Math.abs(Number(move.qty || 0))
    return {
      date: move.created_at,
      product: productName(move.Product),
      location: move.Location?.name || "—",
      reason: move.reason,
      units,
      cost_value: money(units * Number(move.Product?.cost_price || 0)),
      staff: staff.get(move.staff_id) || null,
      note: move.reason_note || null,
    }
  })
  const byReason = Object.fromEntries(LOSS_REASONS.map((reason) => [reason, sum(losses.filter((row) => row.reason === reason), "cost_value")]))
  return {
    summary: {
      batches_with_variance: batches.length,
      cash_short: money(batches.filter((row) => row.variance < 0).reduce((total, row) => total + Number(row.variance), 0)),
      cash_over: money(batches.filter((row) => row.variance > 0).reduce((total, row) => total + Number(row.variance), 0)),
      loss_units: sum(losses, "units"),
      loss_value: sum(losses, "cost_value"),
      loss_value_by_reason: byReason,
    },
    tables: {
      batches: batches.map((row) => ({ batch: row.session_id, opened_at: row.date_time, closed_at: row.closed_at, cashier: row.cashier, expected_cash: row.expected_cash, counted_cash: row.counted_cash, variance: row.variance })),
      losses,
    },
  }
}

/** Staff clock in / out in the range, and hours per staff member. */
async function sessionsSection(actor, location, range) {
  const where = { store_id: actor.store_id, clock_in_at: { [Op.gte]: dateBound(range.from), [Op.lte]: dateBound(range.to, true) } }
  if (location) where.location_id = location.id
  const sessions = await StaffSession.findAll({ where, order: [["clock_in_at", "DESC"]] })
  const userIds = [...new Set(sessions.map((row) => row.user_id).filter(Boolean))]
  const locationIds = [...new Set(sessions.map((row) => row.location_id).filter(Boolean))]
  const [users, locations] = await Promise.all([
    userIds.length ? User.findAll({ where: { id: userIds }, attributes: ["id", "name", "role"] }) : [],
    locationIds.length ? Location.findAll({ where: { id: locationIds }, attributes: ["id", "name"] }) : [],
  ])
  const userOf = new Map(users.map((row) => [row.id, row]))
  const locationOf = new Map(locations.map((row) => [row.id, row.name]))
  const now = Date.now()
  const rows = sessions.map((row) => {
    const end = row.clock_out_at ? new Date(row.clock_out_at).getTime() : now
    return {
      session: row.session_number,
      staff: userOf.get(row.user_id)?.name || "—",
      role: userOf.get(row.user_id)?.role || null,
      location: locationOf.get(row.location_id) || "—",
      clock_in_at: row.clock_in_at,
      clock_out_at: row.clock_out_at,
      hours_worked: money((end - new Date(row.clock_in_at).getTime()) / 3600000),
      status: row.status === "clock_in" ? "on_duty" : "clocked_out",
    }
  })
  const perStaff = new Map()
  for (const row of rows) {
    if (!perStaff.has(row.staff)) perStaff.set(row.staff, { staff: row.staff, role: row.role, sessions: 0, hours_worked: 0 })
    const entry = perStaff.get(row.staff)
    entry.sessions += 1
    entry.hours_worked = money(entry.hours_worked + row.hours_worked)
  }
  return {
    summary: { sessions: rows.length, on_duty_now: rows.filter((row) => row.status === "on_duty").length, hours_worked: sum(rows, "hours_worked") },
    tables: { by_staff: [...perStaff.values()].sort((a, b) => b.hours_worked - a.hours_worked), sessions: rows },
  }
}

// ---------- sections ----------

/** A section object → { summary (single values), tables (lists) }. */
function split(section) {
  const summary = {}
  const tables = {}
  for (const [key, value] of Object.entries(section || {})) {
    if (Array.isArray(value)) tables[key] = value
    else summary[key] = value
  }
  return { summary, tables }
}

async function buildSection(id, ctx) {
  const { actor, scopedQuery, scope, location, range, level, store } = ctx
  const needsOrders = !["inventory", "movements", "transfers", "sessions", "suppliers", "batches", "comparison"].includes(id)
  let orders = []
  let extras = { completed: [] }
  if (needsOrders) {
    orders = await parts.loadOrders(actor, scopedQuery)
    extras = parts.liveOrders(orders)
  }
  const { completed } = extras
  switch (id) {
    case "sales": {
      const { totals, trend, payments } = parts.salesSummary(completed, extras, scopedQuery)
      // Cost and profit are Advanced (Profit & Margin).
      const shown = { ...totals }
      if (levelRank(level) < levelRank("advanced")) {
        delete shown.cost
        delete shown.gross_profit
      }
      delete shown.revenue
      delete shown.tax_collection
      return { summary: shown, tables: { trend, payments } }
    }
    case "payments":
      return split(parts.paymentBreakdown(completed))
    case "batches":
      return split(await parts.zReports(actor, scopedQuery, scope))
    case "top_products":
    case "top_categories": {
      const rows = (id === "top_products" ? parts.byProduct(completed) : parts.byCategory(completed)).rows
      const limited = levelRank(level) < levelRank("standard")
      return { summary: { shown: limited ? Math.min(BASIC_TOP, rows.length) : rows.length, total: rows.length, top_only: limited }, tables: { rows: limited ? rows.slice(0, BASIC_TOP) : rows } }
    }
    case "refunds":
      return split(parts.refundedOrders(orders))
    case "cancelled":
      return split(parts.cancelledOrders(orders))
    case "locations":
      return split(parts.byLocation(completed))
    case "inventory":
      return split(await parts.inventoryReport(actor, scopedQuery, scope))
    case "movements":
      return split(await parts.stockMovementReport(actor, scopedQuery, scope))
    case "transfers":
      return split(await parts.transferReport(actor, scopedQuery, scope))
    case "discounts": {
      const report = await parts.discountReport(actor, completed)
      const { by_source, catalog, sales, rows, ...summary } = report
      return { summary, tables: { by_source, catalog, sales, lines: rows } }
    }
    case "cashiers":
      return split(parts.byCashier(completed))
    case "sessions":
      return sessionsSection(actor, location, range)
    case "profit":
      return profitSection(completed)
    case "tax":
      return split(parts.taxBreakdown(completed))
    case "comparison":
      return comparisonSection(actor, scopedQuery, range)
    case "offers":
      return split(parts.byOffer(completed))
    case "dead_stock":
      return deadStockSection(actor, location, completed, range)
    case "forecast":
      return forecastSection(actor, location, completed, range)
    case "peak_hours":
      return peakHoursSection(completed, store.timezone || "Asia/Karachi")
    case "customers":
      return customersSection(actor, location, completed)
    case "suppliers":
      return suppliersSection(actor, location, range)
    case "variance":
      return varianceSection(actor, scopedQuery, scope, location, range)
    default:
      throw new AppError("Unknown report", 404)
  }
}

async function context(actor, query) {
  if (!["store_admin", "manager"].includes(actor.role)) throw new ForbiddenError("Reporting is for the store admin and managers")
  const store = await getStoreForManager(actor.store_id)
  const { level, plan } = await planLevel(store)
  const range = dateRange(query)
  const location = await resolveLocation(actor, query)
  const channel = normalizeChannel(query)
  const scopedQuery = { from: range.from, to: range.to, channel: channel || undefined, ...(location ? { location_id: location.id } : {}) }
  const scope = reportScope(actor, scopedQuery)
  return { actor, store, level, plan, range, location, channel, scopedQuery, scope }
}

const locationView = (location) => (location ? { id: location.location_id_int, name: location.name } : "all")

function cardsFor(level, location) {
  return CARDS.filter((card) => !card.allOnly || !location).map((card) => ({
    id: card.id,
    label: card.label,
    about: card.about,
    level: card.level,
    locked: levelRank(card.level) > levelRank(level),
  }))
}

/** GET /reporting — the plan's level and every card (locked or not). */
export async function reportingOverview(actor, query = {}) {
  const ctx = await context(actor, query)
  return {
    plan: { name: ctx.plan?.name || null, reporting_level: ctx.level },
    location: locationView(ctx.location),
    from: ctx.range.from,
    to: ctx.range.to,
    cards: cardsFor(ctx.level, ctx.location),
  }
}

/**
 * GET /reporting/:section — one card for the dates and location: summary plus its lists, each
 * paged (?table= the list ?page / ?limit / ?search are for; limit=all for an export).
 */
export async function reportingSection(actor, section, query = {}) {
  const card = CARD.get(section)
  if (!card) throw new AppError("Unknown report", 404)
  const ctx = await context(actor, query)
  if (card.allOnly && ctx.location) throw new AppError(`${card.label} needs location=all`, 400)
  if (levelRank(card.level) > levelRank(ctx.level)) {
    const err = new ForbiddenError(`${card.label} is in the ${card.level} reporting plan. Upgrade to see it.`)
    err.data = { code: "plan_locked", required_level: card.level, reporting_level: ctx.level }
    throw err
  }
  const key = [actor.store_id, actor.role, actor.location_id, section, ctx.level, ctx.location?.id || "all", ctx.range.from, ctx.range.to, ctx.channel || ""].join("|")
  const built = await cached(key, () => buildSection(section, ctx))

  const all = String(query.limit) === "all"
  const limit = all ? "all" : Math.min(MAX_LIMIT, Math.max(1, Number(query.limit) || 20))
  const table = query.table ? String(query.table) : null
  const tables = {}
  for (const [name, rows] of Object.entries(built.tables || {})) {
    const own = !table || table === name
    tables[name] = pageOf(rows, {
      page: own ? Number(query.page) || 1 : 1,
      limit,
      search: own && query.search ? String(query.search).trim() : "",
    })
  }
  return {
    section: card.id,
    label: card.label,
    level: card.level,
    reporting_level: ctx.level,
    location: locationView(ctx.location),
    from: ctx.range.from,
    to: ctx.range.to,
    summary: built.summary || {},
    tables,
  }
}
