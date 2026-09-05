import { Op } from "sequelize"
import { Order } from "./order.model.js"
import { OrderItem } from "./orderItem.model.js"
import { Payment } from "../payments/payment.model.js"
import { getStoreForManager } from "../stores/store.service.js"
import { assertPlan } from "../../shared/utils/plan.util.js"
import { money } from "../commerce/pricing.service.js"
import { AppError } from "../../shared/errors/AppError.js"

const PERIODS = new Set(["daily", "weekly", "monthly", "yearly"])
const EXPORT_TYPES = new Set(["sales", "payments", "profit"])
const EXPORT_FORMATS = new Set(["csv", "xlsx", "pdf"])

function locationScope(actor, query = {}) {
  if (actor.role === "store_admin") {
    return query.location_id || query.locationId || null
  }
  return actor.location_id
}

function orderWhere(actor, query = {}) {
  const where = {
    store_id: actor.store_id,
    order_status: "completed",
  }
  const locationId = locationScope(actor, query)
  if (locationId) where.location_id = locationId
  if (query.channel) where.channel = query.channel
  if (query.from || query.to) {
    where.placed_at = {}
    if (query.from) where.placed_at[Op.gte] = new Date(query.from)
    if (query.to) where.placed_at[Op.lte] = new Date(query.to)
  }
  return where
}

function bucketKey(placedAt, period) {
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
    gross_profit: 0,
  }
}

function addMoney(target, key, value) {
  target[key] = money(Number(target[key] || 0) + Number(value || 0))
}

async function loadCompletedOrders(actor, query) {
  return Order.findAll({
    where: orderWhere(actor, query),
    order: [["placed_at", "ASC"]],
  })
}

async function lineCostsByOrder(orderIds) {
  if (!orderIds.length) return new Map()
  const items = await OrderItem.findAll({
    where: { order_id: { [Op.in]: orderIds } },
    attributes: ["order_id", "cost_price", "quantity"],
  })
  const map = new Map()
  for (const item of items) {
    const add = money(Number(item.cost_price) * Number(item.quantity))
    map.set(item.order_id, money(Number(map.get(item.order_id) || 0) + add))
  }
  return map
}

function summarizeOrders(orders, costsByOrder, period) {
  const groups = new Map()
  const totals = emptyTotals()
  for (const order of orders) {
    const bucket = bucketKey(order.placed_at, period)
    if (!groups.has(bucket)) groups.set(bucket, emptyTotals())
    const row = groups.get(bucket)
    const cost = costsByOrder.get(order.id) ?? Number(order.cost_total)
    const revenue = Number(order.total_amount)
    row.orders += 1
    addMoney(row, "revenue", revenue)
    addMoney(row, "tax", order.tax_amount)
    addMoney(row, "discount", Number(order.discount_amount) + Number(order.coupon_discount_amount))
    addMoney(row, "shipping", order.shipping_fee)
    addMoney(row, "cost", cost)
    row.gross_profit = money(row.revenue - row.cost)
    totals.orders += 1
    addMoney(totals, "revenue", revenue)
    addMoney(totals, "tax", order.tax_amount)
    addMoney(totals, "discount", Number(order.discount_amount) + Number(order.coupon_discount_amount))
    addMoney(totals, "shipping", order.shipping_fee)
    addMoney(totals, "cost", cost)
  }
  totals.gross_profit = money(totals.revenue - totals.cost)
  const rows = [...groups.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([bucket, stats]) => ({ bucket, ...stats }))
  return { rows, totals }
}

function resolvePeriod(query) {
  const period = String(query.period || "daily")
  if (!PERIODS.has(period)) throw new AppError("period must be daily, weekly, monthly, or yearly", 400)
  return period
}

export async function salesReport(actor, query = {}) {
  await getStoreForManager(actor.store_id)
  const period = resolvePeriod(query)
  const orders = await loadCompletedOrders(actor, query)
  const costs = await lineCostsByOrder(orders.map((row) => row.id))
  const { rows, totals } = summarizeOrders(orders, costs, period)
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
      revenue: totals.revenue,
      tax: totals.tax,
      discount: totals.discount,
      shipping: totals.shipping,
    },
  }
}

export async function profitReport(actor, query = {}) {
  await getStoreForManager(actor.store_id)
  const period = resolvePeriod(query)
  const orders = await loadCompletedOrders(actor, query)
  const costs = await lineCostsByOrder(orders.map((row) => row.id))
  const { rows, totals } = summarizeOrders(orders, costs, period)
  return {
    period,
    cost_source: "order_items.cost_price",
    rows: rows.map((row) => ({
      bucket: row.bucket,
      orders: row.orders,
      revenue: row.revenue,
      cost: row.cost,
      gross_profit: row.gross_profit,
    })),
    totals: {
      orders: totals.orders,
      revenue: totals.revenue,
      cost: totals.cost,
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
        attributes: [],
        where: orderWhere(actor, query),
      },
    ],
  })
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
    const headers = ["bucket", "orders", "revenue", "cost", "gross_profit"]
    return { title: "Profit", headers, rows: report.rows }
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
