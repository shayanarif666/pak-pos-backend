import { Op } from "sequelize"
import { Order } from "./order.model.js"
import { OrderItem } from "./orderItem.model.js"
import { OrderRefund } from "./orderRefund.model.js"
import { Payment } from "../payments/payment.model.js"
import { Product } from "../catalog/product.model.js"
import { Category } from "../catalog/category.model.js"
import { ProductStock } from "../catalog/productStock.model.js"
import { StockMovement } from "../inventory/stockMovement.model.js"
import { RegisterSession } from "../pos/registerSession.model.js"
import { Location } from "../locations/location.model.js"
import { User } from "../auth/user.model.js"
import { getStoreForManager } from "../stores/store.service.js"
import { money } from "../commerce/pricing.service.js"
import { AppError } from "../../shared/errors/AppError.js"
import {
  addMoney,
  applyDateRange,
  bucketKey,
  dateBound,
  emptyTaxCollection,
  mergeTaxCollection,
  normalizeChannel,
  orderTaxCollection,
  orderWhere,
  remainingQty,
  reportScope,
  resolvePeriod,
} from "./reports.service.js"

function itemShare(item) {
  const qty = Number(item.quantity || 0)
  if (qty <= 0) return 0
  return remainingQty(item) / qty
}

function liveOrders(orders) {
  const completed = []
  let void_orders = 0
  let refunded_orders = 0
  let refunded_items = 0
  let refunded_amount = 0
  let refunded_tax = 0

  for (const order of orders) {
    if (order.order_status === "voided" || order.order_status === "cancelled") {
      if (order.order_status === "voided") void_orders += 1
      continue
    }
    const refunds = order.OrderRefunds || []
    const refundAmount = money(refunds.reduce((sum, row) => sum + Number(row.amount || 0), 0))
    const refundTax = money(refunds.reduce((sum, row) => sum + Number(row.tax_amount || 0), 0))
    const itemRefundQty = (order.OrderItems || []).reduce(
      (sum, item) => sum + Number(item.refunded_qty || 0),
      0
    )
    refunded_items = money(refunded_items + itemRefundQty)
    refunded_amount = money(refunded_amount + refundAmount)
    refunded_tax = money(refunded_tax + refundTax)
    if (order.order_status === "refunded") refunded_orders += 1
    completed.push({ order, refund: { amount: refundAmount, tax: refundTax } })
  }

  return { completed, void_orders, refunded_orders, refunded_items, refunded_amount, refunded_tax }
}

function trendBucket(placedAt, query) {
  const from = query.from ? String(query.from).slice(0, 10) : ""
  const to = query.to ? String(query.to).slice(0, 10) : ""
  if (from && to && from === to) {
    const d = new Date(placedAt)
    return `${String(d.getHours()).padStart(2, "0")}:00`
  }
  return bucketKey(placedAt, resolvePeriod(query))
}

function salesSummary(completed, extras, query) {
  const trend = new Map()
  let gross_sales = 0
  let discounts = 0
  let tax = 0
  const tax_collection = emptyTaxCollection()
  for (const { order, refund } of completed) {
    const remainingSold = (order.OrderItems || []).reduce((sum, item) => sum + remainingQty(item), 0)
    if (remainingSold <= 0 && refund.amount >= Number(order.total_amount)) continue
    const orderGross = money(Number(order.subtotal || 0))
    const orderDiscount = money(
      Number(order.discount_amount || 0) + Number(order.coupon_discount_amount || 0)
    )
    const orderTax = money(Math.max(0, Number(order.tax_amount || 0) - Number(refund.tax || 0)))
    gross_sales = money(gross_sales + orderGross)
    discounts = money(discounts + orderDiscount)
    tax = money(tax + orderTax)
    mergeTaxCollection(tax_collection, orderTaxCollection(order, refund))
    const bucket = trendBucket(order.placed_at, query)
    if (!trend.has(bucket)) trend.set(bucket, { bucket, sales: 0, orders: 0 })
    const row = trend.get(bucket)
    row.orders += 1
    addMoney(row, "sales", money(Math.max(0, orderGross - orderDiscount)))
  }

  const refunds = extras.refunded_amount
  const net_sales = money(Math.max(0, gross_sales - discounts - refunds))
  const orders = completed.filter(({ order, refund }) => {
    const remainingSold = (order.OrderItems || []).reduce((sum, item) => sum + remainingQty(item), 0)
    return !(remainingSold <= 0 && refund.amount >= Number(order.total_amount))
  }).length
  const payments = paymentBreakdown(completed, extras.refunded_amount)
  const total_collected = money(payments.rows.reduce((sum, row) => sum + Number(row.net_amount), 0))
  const cost = money(
    completed.reduce((sum, { order }) => {
      return money(
        sum +
          (order.OrderItems || []).reduce(
            (lineSum, item) =>
              money(lineSum + Number(item.cost_price || 0) * remainingQty(item)),
            0
          )
      )
    }, 0)
  )

  return {
    totals: {
      gross_sales,
      discounts,
      refunds,
      net_sales,
      cost,
      tax,
      tax_collection,
      total_collected,
      gross_profit: money(net_sales - cost),
      orders,
      avg_order_value: orders ? money(net_sales / orders) : 0,
    },
    trend: [...trend.entries()]
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([, row]) => row),
    payments: payments.rows,
  }
}

function byProduct(completed) {
  const groups = new Map()
  for (const { order } of completed) {
    for (const item of order.OrderItems || []) {
      const share = itemShare(item)
      if (share <= 0) continue
      const key = item.product_id || `custom:${item.title}`
      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          product: item.Product?.title || item.title,
          category: item.Product?.Category?.name || (item.product_id ? "Uncategorized" : "Custom"),
          units_sold: 0,
          total_sales: 0,
        })
      }
      const row = groups.get(key)
      row.units_sold = money(row.units_sold + remainingQty(item))
      addMoney(row, "total_sales", Number(item.subtotal) * share)
    }
  }
  return {
    rows: [...groups.values()].sort((a, b) => Number(b.total_sales) - Number(a.total_sales)),
  }
}

function withPercents(rows, valueKey) {
  const total = rows.reduce((sum, row) => sum + Number(row[valueKey] || 0), 0)
  return rows.map((row) => ({
    ...row,
    percent: total > 0 ? Math.round((Number(row[valueKey] || 0) / total) * 100) : 0,
  }))
}

function byCategory(completed) {
  const groups = new Map()
  for (const { order } of completed) {
    for (const item of order.OrderItems || []) {
      const share = itemShare(item)
      if (share <= 0) continue
      const name = item.Product?.Category?.name || (item.product_id ? "Uncategorized" : "Custom")
      if (!groups.has(name)) {
        groups.set(name, { category: name, units_sold: 0, total_sales: 0 })
      }
      const row = groups.get(name)
      row.units_sold = money(row.units_sold + remainingQty(item))
      addMoney(row, "total_sales", Number(item.subtotal) * share)
    }
  }
  const rows = withPercents(
    [...groups.values()].sort((a, b) => Number(b.total_sales) - Number(a.total_sales)),
    "total_sales"
  )
  return { rows }
}

function paymentBreakdown(completed, refunded_amount) {
  const groups = new Map()
  for (const { order } of completed) {
    for (const payment of order.Payments || []) {
      const method = String(payment.method || "other").toUpperCase()
      if (!groups.has(method)) {
        groups.set(method, { method, transactions: 0, gross_amount: 0, refunds: 0, net_amount: 0 })
      }
      const row = groups.get(method)
      row.transactions += 1
      addMoney(row, "gross_amount", payment.amount)
    }
  }
  if (refunded_amount > 0) {
    const cash = groups.get("CASH") || { method: "CASH", transactions: 0, gross_amount: 0, refunds: 0, net_amount: 0 }
    addMoney(cash, "refunds", refunded_amount)
    groups.set("CASH", cash)
  }
  const rows = withPercents(
    [...groups.values()]
      .map((row) => ({
        ...row,
        net_amount: money(Math.max(0, Number(row.gross_amount) - Number(row.refunds))),
      }))
      .sort((a, b) => Number(b.net_amount) - Number(a.net_amount)),
    "net_amount"
  )
  return {
    rows,
    totals: {
      transactions: rows.reduce((sum, row) => sum + row.transactions, 0),
      gross_amount: money(rows.reduce((sum, row) => sum + Number(row.gross_amount), 0)),
      refunds: money(rows.reduce((sum, row) => sum + Number(row.refunds), 0)),
      net_amount: money(rows.reduce((sum, row) => sum + Number(row.net_amount), 0)),
    },
  }
}

function byCashier(completed) {
  const groups = new Map()
  for (const { order, refund } of completed) {
    const id = order.cashier_id || "unknown"
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        cashier: order.cashier?.name || "Unknown",
        orders: 0,
        total_sales: 0,
        refunds: 0,
        net_sales: 0,
      })
    }
    const row = groups.get(id)
    const sales = money(Number(order.subtotal || 0))
    row.orders += 1
    addMoney(row, "total_sales", sales)
    addMoney(row, "refunds", refund.amount)
    row.net_sales = money(Math.max(0, row.total_sales - row.refunds))
  }
  return { rows: [...groups.values()].sort((a, b) => Number(b.net_sales) - Number(a.net_sales)) }
}

function taxBreakdown(completed) {
  const totals = emptyTaxCollection()
  const orderIds = new Set()
  let total_sales = 0
  for (const { order, refund } of completed) {
    const net = money(Math.max(0, Number(order.total_amount) - Number(refund.amount || 0)))
    total_sales = money(total_sales + net)
    orderIds.add(order.id)
    mergeTaxCollection(totals, orderTaxCollection(order, refund))
  }
  const rows = [
    { id: "product_tax", tax_rule: "Product tax", tax_collected: totals.product_tax },
    { id: "category_tax", tax_rule: "Category tax", tax_collected: totals.category_tax },
    {
      id: "default_store_tax",
      tax_rule: "Default store tax",
      tax_collected: totals.default_store_tax,
    },
    { id: "payment_gst", tax_rule: "Payment method GST", tax_collected: totals.payment_gst },
    { id: "fbr", tax_rule: "FBR collections", tax_collected: totals.fbr },
  ].filter((row) => Number(row.tax_collected) > 0)

  return {
    totals: {
      total_sales,
      tax_collected: totals.total,
      tax_collection: totals,
      orders: orderIds.size,
    },
    rows,
  }
}

function refundVoidRows(orders) {
  const rows = []
  for (const order of orders) {
    if (order.order_status === "voided" || order.order_status === "cancelled") {
      rows.push({
        id: `${order.order_status}:${order.id}`,
        type: order.order_status === "cancelled" ? "cancelled" : "void",
        date: order.placed_at,
        order_number: order.order_number,
        channel: order.channel || null,
        amount: Number(order.total_amount || 0),
        reason: order.void_reason || order.cancel_reason || "",
        cashier: order.cashier?.name || "—",
      })
    }
    for (const refund of order.OrderRefunds || []) {
      rows.push({
        id: refund.id,
        type: "refund",
        date: refund.created_at || order.placed_at,
        order_number: order.order_number,
        channel: order.channel || null,
        amount: Number(refund.amount || 0),
        reason: refund.reason || "",
        cashier: order.cashier?.name || "—",
      })
    }
  }
  rows.sort((a, b) => new Date(b.date) - new Date(a.date))
  return {
    rows,
    totals: {
      refunds: rows.filter((row) => row.type === "refund").length,
      voids: rows.filter((row) => row.type === "void").length,
      cancelled: rows.filter((row) => row.type === "cancelled").length,
      amount: money(rows.reduce((sum, row) => sum + Number(row.amount), 0)),
    },
  }
}

async function loadOrders(actor, query) {
  return Order.findAll({
    where: orderWhere(actor, query, ["completed", "voided", "refunded", "cancelled"]),
    include: [
      {
        model: OrderItem,
        include: [{ model: Product, include: [{ model: Category }] }],
      },
      { model: Payment },
      { model: OrderRefund },
      { model: User, as: "cashier", attributes: ["id", "name", "role"] },
      { model: Location, attributes: ["id", "name"] },
    ],
    order: [["placed_at", "ASC"]],
  })
}

function applyMovementChannel(where, query) {
  const channel = normalizeChannel(query)
  if (!channel) return
  where.channel = { [Op.in]: [channel, "both"] }
}

function shortSessionId(id) {
  return `SESS-${String(id || "").replace(/-/g, "").slice(-4).toUpperCase()}`
}

async function zReports(actor, query, scope) {
  // Register sessions are POS-only.
  if (normalizeChannel(query) === "web") {
    return { rows: [] }
  }
  const where = { store_id: actor.store_id }
  if (scope.location_id) where.location_id = scope.location_id
  if (scope.cashier_id) where.cashier_id = scope.cashier_id
  if (query.from || query.to) {
    where.opened_at = {}
    const from = dateBound(query.from, false)
    const to = dateBound(query.to, true)
    if (from) where.opened_at[Op.gte] = from
    if (to) where.opened_at[Op.lte] = to
  }
  const sessions = await RegisterSession.findAll({
    where,
    include: [
      { model: User, as: "cashier", attributes: ["id", "name"] },
      { model: Location, attributes: ["id", "name"] },
    ],
    order: [["opened_at", "DESC"]],
    limit: 200,
  })
  return {
    rows: sessions.map((row) => {
      const json = row.toJSON()
      return {
        id: json.id,
        date_time: json.opened_at,
        session_id: shortSessionId(json.id),
        status: json.status === "clock_in" ? "OPEN" : "CLOSED",
        sales: Number(json.total_sales || json.net_sales || 0),
        variance: json.cash_variance == null ? 0 : Number(json.cash_variance),
        cashier: json.cashier?.name || "—",
      }
    }),
  }
}

function movementBuckets(type, qty) {
  const n = Number(qty || 0)
  if (type === "stock_in" || type === "transfer_in" || type === "refund") {
    return { inn: Math.abs(n), out: 0 }
  }
  if (type === "stock_out" || type === "sale" || type === "transfer_out" || type === "custom_sale") {
    return { inn: 0, out: Math.abs(n) }
  }
  return n >= 0 ? { inn: n, out: 0 } : { inn: 0, out: Math.abs(n) }
}

async function inventoryReport(actor, query, scope) {
  const where = { store_id: actor.store_id }
  if (scope.location_id) where.location_id = scope.location_id
  const stocks = await ProductStock.findAll({
    where,
    include: [
      {
        model: Product,
        attributes: ["id", "title", "sku"],
        include: [{ model: Category, attributes: ["id", "name"] }],
      },
    ],
    order: [["qty", "ASC"]],
    limit: 400,
  })

  const moveWhere = { store_id: actor.store_id }
  if (scope.location_id) moveWhere.location_id = scope.location_id
  applyDateRange(moveWhere, query)
  if (moveWhere.placed_at) {
    moveWhere.created_at = moveWhere.placed_at
    delete moveWhere.placed_at
  }
  applyMovementChannel(moveWhere, query)
  const moves = await StockMovement.findAll({ where: moveWhere })
  const flow = new Map()
  for (const move of moves) {
    const cur = flow.get(move.product_id) || { inn: 0, out: 0 }
    const next = movementBuckets(move.movement_type, move.qty)
    cur.inn = money(cur.inn + next.inn)
    cur.out = money(cur.out + next.out)
    flow.set(move.product_id, cur)
  }

  return {
    rows: stocks.map((row) => {
      const json = row.toJSON()
      const delta = flow.get(json.product_id) || { inn: 0, out: 0 }
      return {
        id: json.id,
        product: json.Product?.title || "—",
        sku: json.Product?.sku || "—",
        category: json.Product?.Category?.name || "—",
        stock_in: delta.inn,
        stock_out: delta.out,
        current_stock: Number(json.qty || 0),
      }
    }),
  }
}

function prettyReason(reason) {
  return String(reason || "other")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

async function stockMovementReport(actor, query, scope) {
  const where = { store_id: actor.store_id }
  if (scope.location_id) where.location_id = scope.location_id
  if (scope.cashier_id) where.staff_id = scope.cashier_id
  applyDateRange(where, query)
  if (where.placed_at) {
    where.created_at = where.placed_at
    delete where.placed_at
  }
  applyMovementChannel(where, query)
  const rows = await StockMovement.findAll({
    where,
    include: [
      { model: Product, attributes: ["id", "title", "sku"] },
      { model: User, as: "staff", attributes: ["id", "name"] },
    ],
    order: [["created_at", "DESC"]],
    limit: 300,
  })
  return {
    rows: rows.map((row) => {
      const json = row.toJSON()
      return {
        id: json.id,
        date: json.created_at,
        product: json.Product?.title || "—",
        type: String(json.movement_type || "").toUpperCase(),
        qty: Number(json.qty || 0),
        reason: prettyReason(json.reason),
        channel: json.channel || null,
        cashier: json.staff?.name || "System",
      }
    }),
  }
}

async function buildPosReports(actor, query = {}) {
  const period = resolvePeriod(query)
  const channel = normalizeChannel(query)
  const scopedQuery = { ...query, channel: channel || undefined }
  const scope = reportScope(actor, scopedQuery)
  const orders = await loadOrders(actor, scopedQuery)
  const extras = liveOrders(orders)
  const sales_summary = salesSummary(extras.completed, extras, scopedQuery)
  const payments = paymentBreakdown(extras.completed, extras.refunded_amount)
  const [z_reports, inventory, stock_movement] = await Promise.all([
    zReports(actor, scopedQuery, scope),
    inventoryReport(actor, scopedQuery, scope),
    stockMovementReport(actor, scopedQuery, scope),
  ])

  return {
    period,
    channel: channel || "overall",
    scope,
    from: scopedQuery.from || null,
    to: scopedQuery.to || null,
    sales_summary,
    by_product: byProduct(extras.completed),
    by_category: byCategory(extras.completed),
    payments,
    z_reports,
    inventory,
    stock_movement,
    refund_void: refundVoidRows(orders),
    by_cashier: byCashier(extras.completed),
    tax_breakdown: taxBreakdown(extras.completed),
  }
}

export async function storeAdminReports(actor, query = {}) {
  return buildPosReports(actor, query)
}

export async function managerReports(actor, query = {}) {
  return buildPosReports(actor, query)
}

export async function cashierReports(actor, query = {}) {
  return buildPosReports(actor, query)
}

export async function posBreakdownReport(actor, query = {}) {
  await getStoreForManager(actor.store_id)
  if (actor.role === "store_admin") return storeAdminReports(actor, query)
  if (actor.role === "manager") return managerReports(actor, query)
  if (actor.role === "cashier") return cashierReports(actor, query)
  throw new AppError("Reports are not available for this role", 403)
}
