import { Op } from "sequelize"
import { Product } from "../catalog/product.model.js"
import { PaymentSurcharge } from "../surcharges/paymentSurcharge.model.js"
import { money } from "../commerce/pricing.service.js"
import { remainingQty } from "../orders/reports.service.js"

/*
 * The twelve reports of the dashboard, in the shape the endpoint docs give them:
 * - Sales Summary and Profit & Margin: single values only (summary), no lists.
 * - Every other report: one list (tables has one key) and its totals as single values (the KPIs).
 * - Every id is a number (product / variant / category / batch / session / staff / tax / surcharge),
 *   never a UUID; a location is { location (name), location_id (its number) }.
 * - Payment surcharges are never counted as tax: tax = the goods' taxes, payments_tax / surcharge apart.
 */

const sum = (rows, key) => money(rows.reduce((total, row) => total + Number(row[key] || 0), 0))
const percentOf = (rows, key) => {
  const total = rows.reduce((acc, row) => acc + Number(row[key] || 0), 0)
  return rows.map((row) => ({ ...row, percent: total > 0 ? Math.round((Number(row[key] || 0) / total) * 100) : 0 }))
}
const jsonArray = (value) => {
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
const jsonObject = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === "object" ? parsed : null
    } catch {
      return null
    }
  }
  return null
}
/** The sold lines still kept after refunds. */
const keptLines = (completed) => completed.flatMap(({ order, figures }) => figures.lines.filter((line) => line.units > 0).map((line) => ({ order, figures, line })))

// ---------- Sales Summary / Profit & Margin: single values only

/** Sales Summary: one set of figures, the payment surcharges apart from the tax. */
export function salesValues(totals, { withProfit }) {
  const surcharge = money(totals.taxes?.payment_method_tax?.total || 0)
  const values = {
    orders: totals.orders,
    units_sold: totals.units_sold,
    gross_sales: totals.gross_sales,
    items_discounts: totals.line_discounts,
    order_discounts: totals.order_discounts,
    discounts: totals.discounts,
    net_sales: totals.net_sales,
    tax: money(Number(totals.taxes?.total || 0) - surcharge),
    payments_tax: surcharge,
    shipping: totals.shipping,
    total_sales: totals.total_sales,
    total_collected: totals.total_collected,
    on_credit: totals.on_credit,
    refunds: totals.refunds,
    refunded_tax: totals.refunded_tax,
    refunded_orders: totals.refunded_orders,
    refunded_items: totals.refunded_items,
    // Cancelled and voided sales together.
    cancelled_orders: Number(totals.cancelled_orders || 0) + Number(totals.voided_orders || 0),
    cost: totals.cost,
    gross_profit: totals.gross_profit,
  }
  // Cost and profit are in the Advanced plan (Profit & Margin).
  if (!withProfit) {
    delete values.cost
    delete values.gross_profit
  }
  return { summary: values, tables: {} }
}

/** Profit & Margin: net sales, cost, the goods' tax and gross profit. */
export function profitValues(completed) {
  const lines = keptLines(completed).map(({ line }) => line)
  const net = sum(lines, "net")
  const cost = sum(lines, "cost")
  return { summary: { net_sales: net, cost, tax: sum(lines, "tax"), gross_profit: money(net - cost) }, tables: {} }
}

// ---------- By Products / By Categories

/** The product number of a sold line: its own, or its parent's (a variant) with the variant number. */
async function productNumbers(completed) {
  const parentIds = new Set()
  for (const { line } of keptLines(completed)) if (line.item.Product?.parent_product_id) parentIds.add(line.item.Product.parent_product_id)
  const parents = parentIds.size ? await Product.findAll({ where: { id: { [Op.in]: [...parentIds] } }, attributes: ["id", "title", "product_number"] }) : []
  return new Map(parents.map((row) => [row.id, row]))
}

/** By Products: every product (and variant) sold, with all its figures. */
export async function productsTable(completed) {
  const parentOf = await productNumbers(completed)
  const groups = new Map()
  for (const { order, line } of keptLines(completed)) {
    const { item } = line
    const product = item.Product
    const parent = product?.parent_product_id ? parentOf.get(product.parent_product_id) : null
    const key = item.product_id || `custom:${item.title}`
    if (!groups.has(key)) {
      groups.set(key, {
        id: parent ? parent.product_number ?? null : product?.product_number ?? null,
        variant_id: parent ? product?.variant_number ?? null : null,
        product: parent?.title || product?.title || item.title,
        variant: parent ? product?.variant_name || null : null,
        sku: product?.sku || null,
        category: product?.Category?.name || item.custom_category || (item.product_id ? "Uncategorized" : "Custom"),
        unit: item.unit || product?.unit || null,
        orders: new Set(),
        units_sold: 0,
        gross_sales: 0,
        discounts: 0,
        net_sales: 0,
        tax: 0,
        total_sales: 0,
        cost: 0,
      })
    }
    const row = groups.get(key)
    row.orders.add(order.id)
    row.units_sold = money(row.units_sold + line.units)
    row.gross_sales = money(row.gross_sales + line.gross)
    row.discounts = money(row.discounts + line.discount)
    row.net_sales = money(row.net_sales + line.net)
    row.tax = money(row.tax + line.tax)
    row.total_sales = money(row.total_sales + line.total)
    row.cost = money(row.cost + line.cost)
  }
  const rows = [...groups.values()].map(({ orders, cost, ...row }) => ({ ...row, orders: orders.size, cost, gross_profit: money(row.net_sales - cost) }))
  return percentOf(rows.sort((a, b) => b.total_sales - a.total_sales), "total_sales")
}

/** By Categories: every category sold, with all its figures. */
export function categoriesTable(completed) {
  const groups = new Map()
  for (const { order, line } of keptLines(completed)) {
    const { item } = line
    const category = item.Product?.Category
    const name = category?.name || item.custom_category || (item.product_id ? "Uncategorized" : "Custom")
    if (!groups.has(name)) {
      groups.set(name, { id: category?.category_number ?? null, category: name, products: new Set(), orders: new Set(), units_sold: 0, gross_sales: 0, discounts: 0, net_sales: 0, tax: 0, total_sales: 0, cost: 0 })
    }
    const row = groups.get(name)
    row.products.add(item.product_id || item.title)
    row.orders.add(order.id)
    row.units_sold = money(row.units_sold + line.units)
    row.gross_sales = money(row.gross_sales + line.gross)
    row.discounts = money(row.discounts + line.discount)
    row.net_sales = money(row.net_sales + line.net)
    row.tax = money(row.tax + line.tax)
    row.total_sales = money(row.total_sales + line.total)
    row.cost = money(row.cost + line.cost)
  }
  const rows = [...groups.values()].map(({ products, orders, cost, ...row }) => ({ ...row, products: products.size, orders: orders.size, cost, gross_profit: money(row.net_sales - cost) }))
  return percentOf(rows.sort((a, b) => b.total_sales - a.total_sales), "total_sales")
}

// ---------- Payments: every payment method of the store (Payment Surcharges), surcharge and tax apart

export async function paymentsSection(storeId, completed, f = {}) {
  const rules = await PaymentSurcharge.findAll({ where: { store_id: storeId }, order: [["surcharge_number", "ASC"]] })
  const groups = new Map()
  const rowOf = (method, rule = null) => {
    const key = String(method || "other").toLowerCase()
    if (!groups.has(key)) {
      groups.set(key, {
        id: rule?.surcharge_number ?? null,
        method: key,
        surcharge_type: rule?.type ?? null,
        surcharge_value: rule ? Number(rule.charges) : null,
        is_active: rule ? Boolean(rule.is_active) : null,
        transactions: 0,
        bill_amount: 0,
        tax: 0,
        surcharge: 0,
        amount: 0,
        refunds: 0,
        surcharge_refunded: 0,
        net_amount: 0,
      })
    }
    return groups.get(key)
  }
  // Every method the store created comes first, even one nothing was paid with.
  for (const rule of rules) rowOf(rule.method, rule)

  for (const { order } of completed) {
    const payments = (order.Payments || []).filter((row) => !row.status || row.status === "success")
    const bills = payments.map((row) => Number(row.amount || 0) - Number(row.tax_amount || 0))
    const billTotal = bills.reduce((acc, value) => acc + value, 0)
    // The goods' tax of the order, shared over its payments by their part of the bill.
    const goodsTax = (order.OrderItems || []).reduce((acc, item) => acc + Number(item.tax_amount || 0), 0)
    payments.forEach((payment, index) => {
      const row = rowOf(payment.method)
      row.transactions += 1
      row.bill_amount = money(row.bill_amount + bills[index])
      row.surcharge = money(row.surcharge + Number(payment.tax_amount || 0))
      row.amount = money(row.amount + Number(payment.amount || 0))
      row.tax = money(row.tax + (billTotal > 0 ? goodsTax * (bills[index] / billTotal) : 0))
    })
    for (const refund of order.OrderRefunds || []) {
      const parts = jsonArray(refund.payments)
      if (parts.length) {
        for (const part of parts) {
          if (part.method === "credit") continue
          const row = rowOf(part.method)
          row.refunds = money(row.refunds + Number(part.amount || 0))
          row.surcharge_refunded = money(row.surcharge_refunded + Number(part.payment_tax_amount || 0))
        }
      } else if (billTotal > 0) {
        payments.forEach((payment, index) => {
          const row = rowOf(payment.method)
          row.refunds = money(row.refunds + Number(refund.amount || 0) * (bills[index] / billTotal))
        })
      }
    }
  }
  let rows = [...groups.values()].map((row) => ({ ...row, net_amount: money(Math.max(0, row.amount - row.refunds)) }))
  if (f.method) rows = rows.filter((row) => row.method === String(f.method).toLowerCase())
  rows = percentOf(rows, "net_amount")
  return {
    summary: {
      methods: rows.length,
      transactions: rows.reduce((acc, row) => acc + row.transactions, 0),
      bill_amount: sum(rows, "bill_amount"),
      tax: sum(rows, "tax"),
      surcharge: sum(rows, "surcharge"),
      amount: sum(rows, "amount"),
      refunds: sum(rows, "refunds"),
      net_amount: sum(rows, "net_amount"),
    },
    tables: { payments: rows },
  }
}

// ---------- Z-Reports: the batches history

export function batchesTable(zRows) {
  return zRows.map((row) => ({
    id: row.batch_number,
    location: row.location,
    location_id: row.location_number,
    cashier: row.cashier,
    cashier_id: row.cashier_number,
    status: row.status === "OPEN" ? "open" : "closed",
    opened_at: row.date_time,
    closed_at: row.closed_at,
    opening_amount: row.opening_amount,
    orders: row.orders,
    gross_sales: row.gross_sales,
    discounts: row.discounts,
    net_sales: row.net_sales,
    tax: money(Number(row.tax || 0) - Number(row.surcharge || 0)),
    surcharge: row.surcharge,
    refunds: row.refunds,
    total_sales: row.total_sales,
    cash_sales: row.cash_sales,
    card_sales: row.card_sales,
    jazzcash_sales: row.jazzcash_sales,
    easypaisa_sales: row.easypaisa_sales,
    cash_in: row.cash_in,
    cash_out: row.cash_out,
    expected_cash: row.expected_cash,
    counted_cash: row.counted_cash,
    variance: row.variance,
  }))
}

// ---------- By Cashiers: highest sales first

export function cashiersTable(completed, sortKey = "total_sales") {
  const groups = new Map()
  for (const { order, figures } of completed) {
    const key = order.cashier_id || "unknown"
    if (!groups.has(key)) {
      groups.set(key, { id: order.cashier?.user_number ?? null, cashier: order.cashier?.name || "Unknown", role: order.cashier?.role || null, orders: 0, units_sold: 0, gross_sales: 0, discounts: 0, net_sales: 0, tax: 0, total_sales: 0, refunds: 0 })
    }
    const row = groups.get(key)
    const surcharge = Number(figures.taxes.payment_method_tax.total || 0)
    row.orders += 1
    row.units_sold = money(row.units_sold + figures.units)
    row.gross_sales = money(row.gross_sales + figures.gross)
    row.discounts = money(row.discounts + figures.discount)
    row.net_sales = money(row.net_sales + figures.net)
    row.tax = money(row.tax + Number(figures.taxes.total || 0) - surcharge)
    row.total_sales = money(row.total_sales + figures.total)
    row.refunds = money(row.refunds + figures.refunded)
  }
  return [...groups.values()].sort((a, b) => Number(b[sortKey] || 0) - Number(a[sortKey] || 0))
}

// ---------- Sessions History

export function sessionsTable(rows) {
  return rows.map((row) => ({
    id: row.session,
    staff: row.staff,
    staff_id: row.staff_number,
    role: row.role,
    location: row.location,
    location_id: row.location_number,
    clock_in_at: row.clock_in_at,
    clock_out_at: row.clock_out_at,
    hours_worked: row.hours_worked,
    status: row.status,
  }))
}

// ---------- Refunds / Cancelled: one list, the totals as single values

export function refundsCancelledValues(rows) {
  const count = (type) => rows.filter((row) => row.type === type).length
  const amountOf = (types) => sum(rows.filter((row) => types.includes(row.type)), "amount")
  return {
    refunds: count("partial_refund") + count("complete_refund"),
    complete_refunds: count("complete_refund"),
    partial_refunds: count("partial_refund"),
    voided_orders: count("voided"),
    cancelled_orders: count("cancelled"),
    refunded_amount: amountOf(["partial_refund", "complete_refund"]),
    cancelled_amount: amountOf(["voided", "cancelled"]),
  }
}

// ---------- Discount Performance: every discount given (line discounts, the order discount, bundles)

export function discountPerformance(completed, f = {}) {
  const groups = new Map()
  const rowOf = (entry) => {
    const level = String(entry.level || "manual")
    const name = entry.name || "Discount"
    const key = `${level}|${entry.id ?? ""}|${name.toLowerCase()}`
    if (!groups.has(key)) {
      groups.set(key, { id: entry.id ?? null, discount: name, level, type: entry.type || null, value: entry.value == null ? null : Number(entry.value), orders: new Set(), units: 0, sales: 0, discount_given: 0 })
    }
    return groups.get(key)
  }
  for (const { order, line } of keptLines(completed)) {
    const { item } = line
    const qty = Number(item.quantity || 0)
    const share = qty > 0 ? remainingQty(item) / qty : 0
    for (const entry of jsonArray(item.discount_entries)) {
      const amount = Number(entry.amount || 0) * share
      if (amount <= 0) continue
      const row = rowOf(entry)
      row.orders.add(order.id)
      row.units = money(row.units + line.units)
      row.sales = money(row.sales + line.net)
      row.discount_given = money(row.discount_given + amount)
    }
    // The order discount, spread over the lines (as the figures do).
    const orderDiscount = jsonObject(order.order_discount)
    if (orderDiscount && line.order_discount > 0) {
      const row = rowOf({ ...orderDiscount, level: "order" })
      row.orders.add(order.id)
      row.units = money(row.units + line.units)
      row.sales = money(row.sales + line.net)
      row.discount_given = money(row.discount_given + line.order_discount)
    }
  }
  let rows = [...groups.values()].map(({ orders, ...row }) => ({ ...row, orders: orders.size }))
  if (f.level) rows = rows.filter((row) => row.level === f.level)
  rows.sort((a, b) => b.discount_given - a.discount_given)
  return {
    summary: {
      discounts: rows.length,
      orders_discounted: new Set(keptLines(completed).filter(({ line }) => line.discount > 0).map(({ order }) => order.id)).size,
      discount_given: sum(rows, "discount_given"),
      sales: money(keptLines(completed).filter(({ line }) => line.discount > 0).reduce((acc, { line }) => acc + line.net, 0)),
    },
    tables: { discounts: rows },
  }
}

// ---------- Tax Breakdown: every tax collected (no surcharges: they are in Payments)

export function taxValues(completed, rules) {
  const kept = completed.filter(({ figures }) => !figures.fully_refunded)
  const lines = keptLines(kept).map(({ line }) => line)
  const byLevel = (level) => sum(rules.filter((rule) => rule.level === level), "tax_collected")
  return {
    orders: kept.length,
    net_sales: sum(lines, "net"),
    tax_collected: sum(lines, "tax"),
    store_tax: byLevel("store"),
    product_tax: byLevel("product"),
    variant_tax: byLevel("variant"),
    category_tax: byLevel("category"),
    sales_with_tax: money(sum(lines, "net") + sum(lines, "tax")),
  }
}
