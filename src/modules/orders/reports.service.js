import { Op } from "sequelize"
import { Order } from "./order.model.js"
import { OrderItem } from "./orderItem.model.js"
import { OrderRefund } from "./orderRefund.model.js"
import { Payment } from "../payments/payment.model.js"
import { getStoreForManager } from "../stores/store.service.js"
import { assertPlan } from "../../shared/utils/plan.util.js"
import { money } from "../commerce/pricing.service.js"
import { AppError } from "../../shared/errors/AppError.js"

const PERIODS = new Set(["daily", "weekly", "monthly", "yearly"])
const EXPORT_TYPES = new Set(["sales", "payments", "profit"])
const EXPORT_FORMATS = new Set(["csv", "xlsx", "pdf"])

export function reportScope(actor, query = {}) {
  if (actor.role === "store_admin") {
    const location_id = query.location_id || query.locationId || null
    return {
      role: actor.role,
      location_id,
      cashier_id: query.cashier_id || null,
      all_locations: !location_id,
    }
  }
  if (actor.role === "manager") {
    return {
      role: actor.role,
      location_id: actor.location_id,
      cashier_id: null,
      all_locations: false,
    }
  }
  if (actor.role === "cashier") {
    return {
      role: actor.role,
      location_id: actor.location_id,
      cashier_id: actor.id,
      all_locations: false,
    }
  }
  throw new AppError("Reports are not available for this role", 403)
}

export function dateBound(value, end = false) {
  if (!value) return null
  const raw = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(end ? `${raw}T23:59:59.999` : `${raw}T00:00:00.000`)
  }
  return new Date(value)
}

export function applyDateRange(where, query = {}) {
  if (!query.from && !query.to) return
  where.placed_at = {}
  const from = dateBound(query.from, false)
  const to = dateBound(query.to, true)
  if (from) where.placed_at[Op.gte] = from
  if (to) where.placed_at[Op.lte] = to
}

export function orderWhere(actor, query = {}, statuses = ["completed"]) {
  const scope = reportScope(actor, query)
  const where = {
    store_id: actor.store_id,
    order_status: statuses.length === 1 ? statuses[0] : { [Op.in]: statuses },
  }
  if (scope.location_id) where.location_id = scope.location_id
  if (scope.cashier_id) where.cashier_id = scope.cashier_id
  if (query.channel) where.channel = query.channel
  applyDateRange(where, query)
  return where
}

export function bucketKey(placedAt, period) {
  const d = new Date(placedAt)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  if (period === "yearly") return String(y)
  if (period === "monthly") return `${y}-${m}`
  if (period === "weekly") {
    const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    const dayNum = tmp.getUTCDay() || 7
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum)
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
    const week = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7)
    return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
  }
  return `${y}-${m}-${day}`
}

function emptyTotals() {
  return {
    orders: 0,
    revenue: 0,
    tax: 0,
    discount: 0,
    shipping: 0,
    cost: 0,
    refunds: 0,
    total_collected: 0,
    gross_profit: 0,
    tax_collection: emptyTaxCollection(),
  }
}

export function emptyTaxCollection() {
  return {
    product_tax: 0,
    category_tax: 0,
    default_store_tax: 0,
    payment_gst: 0,
    fbr: 0,
    total: 0,
  }
}

export function orderTaxCollection(order, refund = { amount: 0, tax: 0 }) {
  const collected = emptyTaxCollection()
  for (const item of order.OrderItems || []) {
    const qty = Number(item.quantity || 0)
    const share = qty > 0 ? remainingQty(item) / qty : 0
    if (share <= 0) continue
    const product = Number(item.product_tax_amount || 0) * share
    const category = Number(item.category_tax_amount || 0) * share
    const storeDefault = Number(item.default_tax_amount || 0) * share
    if (product || category || storeDefault) {
      addMoney(collected, "product_tax", product)
      addMoney(collected, "category_tax", category)
      addMoney(collected, "default_store_tax", storeDefault)
    } else {
      addMoney(collected, "default_store_tax", Number(item.tax_amount || 0) * share)
    }
  }
  const total = Number(order.total_amount || 0)
  const orderShare =
    total > 0 ? Math.max(0, (total - Number(refund.amount || 0)) / total) : 0
  addMoney(collected, "payment_gst", Number(order.payment_gst_amount || 0) * orderShare)
  if (order.fbr_invoice_enabled) {
    addMoney(collected, "fbr", Number(order.fbr_tax_amount || 0) * orderShare)
  }
  collected.total = money(
    collected.product_tax +
      collected.category_tax +
      collected.default_store_tax +
      collected.payment_gst
  )
  return collected
}

export function mergeTaxCollection(target, next) {
  addMoney(target, "product_tax", next.product_tax)
  addMoney(target, "category_tax", next.category_tax)
  addMoney(target, "default_store_tax", next.default_store_tax)
  addMoney(target, "payment_gst", next.payment_gst)
  addMoney(target, "fbr", next.fbr)
  target.total = money(
    target.product_tax + target.category_tax + target.default_store_tax + target.payment_gst
  )
  return target
}

export function addMoney(target, key, value) {
  target[key] = money(Number(target[key] || 0) + Number(value || 0))
}

async function loadCompletedOrders(actor, query) {
  return Order.findAll({
    where: orderWhere(actor, query),
    include: [{ model: OrderItem }],
    order: [["placed_at", "ASC"]],
  })
}

export function remainingQty(item) {
  return Math.max(0, Number(item.quantity) - Number(item.refunded_qty || 0))
}

function netCost(order) {
  const items = order.OrderItems || []
  if (!items.length) return Number(order.cost_total || 0)
  return items.reduce((sum, item) => {
    return money(sum + Number(item.cost_price || 0) * remainingQty(item))
  }, 0)
}

async function refundsByOrder(orderIds) {
  const map = new Map()
  if (!orderIds.length) return map
  const rows = await OrderRefund.findAll({
    where: { order_id: { [Op.in]: orderIds } },
  })
  for (const row of rows) {
    const cur = map.get(row.order_id) || { amount: 0, tax: 0 }
    cur.amount = money(cur.amount + Number(row.amount || 0))
    cur.tax = money(cur.tax + Number(row.tax_amount || 0))
    map.set(row.order_id, cur)
  }
  return map
}

export function summarizeOrders(orders, refundMap, period) {
  const groups = new Map()
  const totals = emptyTotals()
  for (const order of orders) {
    const refund = refundMap.get(order.id) || { amount: 0, tax: 0 }
    const remainingSold = (order.OrderItems || []).reduce(
      (sum, item) => sum + remainingQty(item),
      0
    )
    if (remainingSold <= 0 && refund.amount >= Number(order.total_amount)) continue

    const bucket = bucketKey(order.placed_at, period)
    if (!groups.has(bucket)) groups.set(bucket, emptyTotals())
    const row = groups.get(bucket)
    const cost = netCost(order)
    const revenue = money(Math.max(0, Number(order.total_amount) - refund.amount))
    const tax = money(Math.max(0, Number(order.tax_amount) - refund.tax))
    const taxes = orderTaxCollection(order, refund)
    row.orders += 1
    addMoney(row, "revenue", revenue)
    addMoney(row, "tax", tax)
    addMoney(row, "discount", Number(order.discount_amount) + Number(order.coupon_discount_amount))
    addMoney(row, "shipping", order.shipping_fee)
    addMoney(row, "cost", cost)
    addMoney(row, "refunds", refund.amount)
    addMoney(row, "total_collected", revenue)
    mergeTaxCollection(row.tax_collection, taxes)
    row.gross_profit = money(row.revenue - row.cost)
    totals.orders += 1
    addMoney(totals, "revenue", revenue)
    addMoney(totals, "tax", tax)
    addMoney(totals, "discount", Number(order.discount_amount) + Number(order.coupon_discount_amount))
    addMoney(totals, "shipping", order.shipping_fee)
    addMoney(totals, "cost", cost)
    addMoney(totals, "refunds", refund.amount)
    addMoney(totals, "total_collected", revenue)
    mergeTaxCollection(totals.tax_collection, taxes)
  }
  totals.gross_profit = money(totals.revenue - totals.cost)
  const rows = [...groups.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([bucket, stats]) => ({ bucket, ...stats }))
  return { rows, totals }
}

export function resolvePeriod(query) {
  const period = String(query.period || "daily")
  if (!PERIODS.has(period)) throw new AppError("period must be daily, weekly, monthly, or yearly", 400)
  return period
}

export async function dashboardReport(actor, query = {}) {
  await getStoreForManager(actor.store_id)
  const period = resolvePeriod(query)
  const statuses = ["completed", "voided", "refunded"]
  const orders = await Order.findAll({
    where: orderWhere(actor, query, statuses),
    include: [{ model: OrderItem }, { model: Payment }, { model: OrderRefund }],
    order: [["placed_at", "ASC"]],
  })

  const completed = []
  let void_orders = 0
  let refunded_orders = 0
  let refunded_items = 0
  let refunded_amount = 0

  for (const order of orders) {
    if (order.order_status === "voided") {
      void_orders += 1
      continue
    }
    const refunds = order.OrderRefunds || []
    const refundAmount = money(
      refunds.reduce((sum, row) => sum + Number(row.amount || 0), 0)
    )
    const refundTax = money(
      refunds.reduce((sum, row) => sum + Number(row.tax_amount || 0), 0)
    )
    const itemRefundQty = (order.OrderItems || []).reduce(
      (sum, item) => sum + Number(item.refunded_qty || 0),
      0
    )
    refunded_items = money(refunded_items + itemRefundQty)
    refunded_amount = money(refunded_amount + refundAmount)
    if (order.order_status === "refunded") refunded_orders += 1
    else completed.push({ order, refund: { amount: refundAmount, tax: refundTax } })
  }

  const refundMap = new Map(
    completed.map(({ order, refund }) => [order.id, refund])
  )
  const liveOrders = completed.map((row) => row.order)
  const { rows, totals } = summarizeOrders(liveOrders, refundMap, period)

  const payMap = new Map(
    ["cash", "card", "jazzcash", "easypaisa"].map((method) => [
      method,
      { method, count: 0, amount: 0, tax: 0 },
    ])
  )
  for (const { order } of completed) {
    for (const payment of order.Payments || []) {
      const method = payment.method
      if (!payMap.has(method)) {
        payMap.set(method, { method, count: 0, amount: 0, tax: 0 })
      }
      const bucket = payMap.get(method)
      bucket.count += 1
      addMoney(bucket, "amount", payment.amount)
      addMoney(bucket, "tax", payment.tax_amount)
    }
  }
  if (refunded_amount > 0 && payMap.has("cash")) {
    const cash = payMap.get("cash")
    cash.amount = money(Math.max(0, Number(cash.amount) - refunded_amount))
  }
  const payments = [...payMap.values()]
  const collected = money(payments.reduce((sum, row) => sum + Number(row.amount), 0))

  return {
    period,
    payments,
    totals: {
      collected,
      cash: payMap.get("cash")?.amount || 0,
      card: payMap.get("card")?.amount || 0,
      jazzcash: payMap.get("jazzcash")?.amount || 0,
      easypaisa: payMap.get("easypaisa")?.amount || 0,
      orders: totals.orders,
      revenue: totals.revenue,
      tax: totals.tax,
      cost: totals.cost,
      discount: totals.discount,
      shipping: totals.shipping,
      gross_profit: totals.gross_profit,
      refunded_items,
      refunded_orders,
      void_orders,
      refunded_amount,
    },
    rows: rows.map((row) => ({
      bucket: row.bucket,
      orders: row.orders,
      revenue: row.revenue,
      tax: row.tax,
      cost: row.cost,
      gross_profit: row.gross_profit,
    })),
  }
}

export async function salesReport(actor, query = {}) {
  await getStoreForManager(actor.store_id)
  const period = resolvePeriod(query)
  const orders = await loadCompletedOrders(actor, query)
  const refunds = await refundsByOrder(orders.map((row) => row.id))
  const { rows, totals } = summarizeOrders(orders, refunds, period)
  return {
    period,
    rows: rows.map((row) => ({
      bucket: row.bucket,
      orders: row.orders,
      revenue: row.revenue,
      tax: row.tax,
      discount: row.discount,
      shipping: row.shipping,
    })),
    totals: {
      orders: totals.orders,
      sales_collected: totals.total_collected,
      revenue: totals.revenue,
      cost: totals.cost,
      discounts: totals.discount,
      refunds: totals.refunds,
      tax: totals.tax_collection.total,
      tax_collection: totals.tax_collection,
      shipping: totals.shipping,
      gross_profit: totals.gross_profit,
    },
  }
}

export async function profitReport(actor, query = {}) {
  await getStoreForManager(actor.store_id)
  const period = resolvePeriod(query)
  const orders = await loadCompletedOrders(actor, query)
  const refunds = await refundsByOrder(orders.map((row) => row.id))
  const { totals } = summarizeOrders(orders, refunds, period)
  return {
    period,
    totals: {
      orders: totals.orders,
      sales_collected: totals.total_collected,
      cost: totals.cost,
      discounts: totals.discount,
      refunds: totals.refunds,
      tax_collection: totals.tax_collection,
      tax: totals.tax_collection.total,
      gross_profit: totals.gross_profit,
    },
  }
}

export async function paymentsReport(actor, query = {}) {
  await getStoreForManager(actor.store_id)
  const payments = await Payment.findAll({
    include: [
      {
        model: Order,
        required: true,
        attributes: ["id"],
        where: orderWhere(actor, query),
      },
    ],
  })
  const refunds = await refundsByOrder(
    [...new Set(payments.map((row) => row.order_id).filter(Boolean))]
  )
  const groups = new Map()
  let amount = 0
  let tax = 0
  for (const row of payments) {
    const method = row.method
    if (!groups.has(method)) {
      groups.set(method, { method, count: 0, amount: 0, tax: 0 })
    }
    const bucket = groups.get(method)
    bucket.count += 1
    addMoney(bucket, "amount", row.amount)
    addMoney(bucket, "tax", row.tax_amount)
    amount = money(amount + Number(row.amount))
    tax = money(tax + Number(row.tax_amount))
  }
  const refundTotal = [...refunds.values()].reduce((sum, row) => money(sum + row.amount), 0)
  const refundTax = [...refunds.values()].reduce((sum, row) => money(sum + row.tax), 0)
  if (refundTotal > 0) {
    const cash = groups.get("cash") || { method: "cash", count: 0, amount: 0, tax: 0 }
    cash.amount = money(Math.max(0, Number(cash.amount) - refundTotal))
    cash.tax = money(Math.max(0, Number(cash.tax) - refundTax))
    groups.set("cash", cash)
    amount = money(Math.max(0, amount - refundTotal))
    tax = money(Math.max(0, tax - refundTax))
  }
  return {
    rows: [...groups.values()].sort((a, b) => a.method.localeCompare(b.method)),
    totals: { count: payments.length, amount, tax },
  }
}

function csvEscape(value) {
  const text = value == null ? "" : String(value)
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function toCsv(headers, rows) {
  const lines = [headers.join(",")]
  for (const row of rows) {
    lines.push(headers.map((key) => csvEscape(row[key])).join(","))
  }
  return lines.join("\r\n") + "\r\n"
}

function toXlsx(sheetName, headers, rows) {
  const cells = (values, type = "String") =>
    values
      .map((value) => {
        const isNum = type === "Number" || typeof value === "number"
        const ssType = isNum ? "Number" : "String"
        const text = value == null ? "" : String(value)
        const escaped = text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
        return `<Cell><Data ss:Type="${ssType}">${escaped}</Data></Cell>`
      })
      .join("")

  const headerRow = `<Row>${cells(headers)}</Row>`
  const body = rows
    .map(
      (row) =>
        `<Row>${headers
          .map((key) => {
            const value = row[key]
            const ssType = typeof value === "number" ? "Number" : "String"
            return cells([value], ssType)
          })
          .join("")}</Row>`
    )
    .join("")

  return (
    `<?xml version="1.0"?>\r\n` +
    `<?mso-application progid="Excel.Sheet"?>\r\n` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ` +
    `xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
    `<Worksheet ss:Name="${sheetName}"><Table>${headerRow}${body}</Table></Worksheet>` +
    `</Workbook>`
  )
}

function toPdf(title, headers, rows) {
  const lines = [title, headers.join(" | "), ...rows.map((row) => headers.map((key) => row[key]).join(" | "))]
  const content = lines
    .map((line, index) => {
      const y = 760 - index * 14
      const safe = String(line).replace(/[()\\]/g, " ")
      return `BT /F1 9 Tf 40 ${y} Td (${safe}) Tj ET`
    })
    .join("\n")
  const stream = content + "\n"
  const objects = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj",
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj",
    `4 0 obj<< /Length ${Buffer.byteLength(stream)} >>stream\n${stream}endstream\nendobj`,
    "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>endobj",
  ]
  let offset = 9
  const xref = ["0000000000 65535 f "]
  const chunks = ["%PDF-1.1\n"]
  for (const obj of objects) {
    xref.push(String(offset).padStart(10, "0") + " 00000 n ")
    chunks.push(obj + "\n")
    offset += Buffer.byteLength(obj + "\n")
  }
  const xrefStart = offset
  chunks.push(`xref\n0 ${objects.length + 1}\n${xref.join("\n")}\n`)
  chunks.push(`trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`)
  return chunks.join("")
}

function tableFromReport(type, report) {
  if (type === "payments") {
    const headers = ["method", "count", "amount", "tax"]
    return { title: "Payments", headers, rows: report.rows }
  }
  if (type === "profit") {
    const headers = ["orders", "revenue", "cost", "gross_profit"]
    return { title: "Profit", headers, rows: report.totals ? [report.totals] : [] }
  }
  const headers = ["bucket", "orders", "revenue", "tax", "discount", "shipping"]
  return { title: "Sales", headers, rows: report.rows }
}

export async function exportReport(actor, query = {}) {
  const store = await getStoreForManager(actor.store_id)
  await assertPlan(store, "advanced_reports")
  const type = String(query.type || "sales")
  const format = String(query.format || "csv")
  if (!EXPORT_TYPES.has(type)) throw new AppError("type must be sales, payments, or profit", 400)
  if (!EXPORT_FORMATS.has(format)) throw new AppError("format must be csv, xlsx, or pdf", 400)

  const report =
    type === "payments"
      ? await paymentsReport(actor, query)
      : type === "profit"
        ? await profitReport(actor, query)
        : await salesReport(actor, query)
  const table = tableFromReport(type, report)
  if (format === "xlsx") {
    return {
      filename: `${type}-report.xlsx`,
      contentType: "application/vnd.ms-excel",
      body: toXlsx(table.title, table.headers, table.rows),
    }
  }
  if (format === "pdf") {
    return {
      filename: `${type}-report.pdf`,
      contentType: "application/pdf",
      body: toPdf(table.title, table.headers, table.rows),
    }
  }
  return {
    filename: `${type}-report.csv`,
    contentType: "text/csv; charset=utf-8",
    body: toCsv(table.headers, table.rows),
  }
}
