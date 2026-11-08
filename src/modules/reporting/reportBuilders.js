import { money } from "../commerce/pricing.service.js"
import { Category } from "../catalog/category.model.js"
import { Product } from "../catalog/product.model.js"
import { PaymentSurcharge } from "../surcharges/paymentSurcharge.model.js"
import { StoreTax } from "../taxes/storeTax.model.js"
import { remainingQty } from "../orders/reports.service.js"
import { PAYMENT_METHODS, productKind } from "./reportFilters.js"

/* The sections / parts of GET /reporting/:section that are built here (the rest come from
 * orders/reports.pos.service.js). */

const sum = (rows, key) => money(rows.reduce((total, row) => total + Number(row[key] || 0), 0))

function jsonArray(value) {
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

/** Payments: only one method's row (method=…), its totals worked out again. */
export function onlyMethod(report, method) {
  const label = method.toUpperCase()
  const kept = report.rows.filter((row) => row.method === label)
  const net = sum(kept, "net_amount")
  const rows = kept.map((row) => ({ ...row, percent: net > 0 ? Math.round((Number(row.net_amount) / net) * 100) : 0 }))
  return {
    rows,
    totals: {
      transactions: rows.reduce((total, row) => total + row.transactions, 0),
      gross_amount: sum(rows, "gross_amount"),
      tax: sum(rows, "tax"),
      refunds: sum(rows, "refunds"),
      net_amount: net,
    },
  }
}

/** Z-reports: each cashier's overall sales across the batches listed (sales are after refunds, like the batch rows). */
export function cashierTotals(batchRows) {
  const groups = new Map()
  for (const row of batchRows) {
    const key = row.cashier_id || row.cashier
    if (!groups.has(key)) groups.set(key, { id: row.cashier_id || null, cashier: row.cashier, batches: 0, orders: 0, discounts: 0, tax: 0, refunds: 0, total_sales: 0 })
    const entry = groups.get(key)
    entry.batches += 1
    entry.orders += Number(row.orders || 0)
    for (const name of ["discounts", "tax", "refunds", "total_sales"]) entry[name] = money(entry[name] + Number(row[name] || 0))
  }
  return [...groups.values()].sort((a, b) => b.total_sales - a.total_sales)
}

/** By Products › zero_sales: active products that sold nothing in the dates (their figures are 0). */
export async function zeroSalesRows(storeId, completed, f) {
  const sold = new Set()
  for (const { figures } of completed) {
    for (const line of figures.lines) if (line.units > 0 && line.item.product_id) sold.add(line.item.product_id)
  }
  const products = await Product.findAll({
    where: { store_id: storeId, is_active: true, has_variants: false, deleted_at: null },
    include: [{ model: Category, attributes: ["id", "name"] }],
    order: [["title", "ASC"]],
  })
  return products
    .filter((product) => !sold.has(product.id) && (!f.type || productKind(product) === f.type))
    .map((product) => ({
      id: product.id,
      product: product.title,
      category: product.Category?.name || "Uncategorized",
      unit: product.unit || null,
      units_sold: 0,
      gross_sales: 0,
      discounts: 0,
      net_sales: 0,
      sales_tax: 0,
      product_tax: 0,
      category_tax: 0,
      tax: 0,
      total_sales: 0,
      percent: 0,
    }))
}

/** By Categories › sort=profit: the rows by what they earned (net − cost); cost and profit shown on the advanced plan. */
export function categoriesByProfit(rows, source, showProfit) {
  const profit = new Map()
  for (const { figures } of source) {
    for (const line of figures.lines) {
      if (line.units <= 0) continue
      const item = line.item
      const name = item.Product?.Category?.name || item.custom_category || (item.product_id ? "Uncategorized" : "Custom")
      const row = profit.get(name) || { cost: 0, net: 0 }
      row.cost = money(row.cost + line.cost)
      row.net = money(row.net + line.net)
      profit.set(name, row)
    }
  }
  const earned = (row) => (profit.get(row.category)?.net || 0) - (profit.get(row.category)?.cost || 0)
  return [...rows]
    .sort((a, b) => earned(b) - earned(a))
    .map((row) => (showProfit ? { ...row, cost: profit.get(row.category)?.cost || 0, gross_profit: money(earned(row)) } : row))
}

/**
 * Refunds / Cancelled: every refund (partial and complete), cancelled order and voided order in
 * one list, newest first. Filters: type, reason (contains), refund_method (refunds only).
 */
export function refundsCancelledSection(orders, f) {
  let rows = []
  for (const order of orders) {
    const cashier = order.cashier?.name || "—"
    if (order.order_status === "voided" || order.order_status === "cancelled") {
      rows.push({
        id: order.order_number,
        type: order.order_status,
        date: order.updated_at || order.placed_at,
        order_number: order.order_number,
        channel: order.channel || null,
        amount: money(order.total_amount || 0),
        reason: order.void_reason || order.cancel_reason || "",
        cashier,
        refund_methods: [],
      })
    }
    for (const refund of order.OrderRefunds || []) {
      rows.push({
        id: refund.refund_number,
        type: refund.refund_type === "complete" ? "complete_refund" : "partial_refund",
        date: refund.refunded_at || refund.created_at || order.placed_at,
        order_number: order.order_number,
        channel: order.channel || null,
        amount: money(refund.amount || 0),
        reason: refund.reason || "",
        cashier,
        refund_methods: [...new Set(jsonArray(refund.payments).map((part) => part.method).filter(Boolean))],
      })
    }
  }
  if (f.type) rows = rows.filter((row) => row.type === f.type)
  if (f.reason) rows = rows.filter((row) => row.reason.toLowerCase().includes(f.reason.toLowerCase()))
  if (f.refund_method) rows = rows.filter((row) => row.refund_methods.includes(f.refund_method))
  rows.sort((a, b) => new Date(b.date) - new Date(a.date))
  const count = (type) => rows.filter((row) => row.type === type).length
  return {
    summary: {
      totals: {
        refund_count: count("partial_refund") + count("complete_refund"),
        complete: count("complete_refund"),
        partial: count("partial_refund"),
        voids: count("voided"),
        cancelled: count("cancelled"),
        amount: sum(rows, "amount"),
      },
    },
    tables: { rows },
  }
}

/**
 * Tax Report: the tax collected per tax rule (a rule = its level + name), after refunds, and the
 * payment surcharge on its own (it is not a tax). Filters: tax_name, level, tax_type.
 */
export async function taxReport(storeId, completed, f) {
  const [storeTaxes, surchargeRules] = await Promise.all([
    StoreTax.findAll({ where: { store_id: storeId }, attributes: ["name", "type"] }),
    PaymentSurcharge.findAll({ where: { store_id: storeId }, attributes: ["method", "type", "charges"] }),
  ])
  const storeType = new Map(storeTaxes.map((tax) => [String(tax.name).toLowerCase(), tax.type]))
  const typeOf = (level, name, item) => {
    const lower = String(name).toLowerCase()
    if (level === "store") return storeType.get(lower) || "percentage"
    if (level === "product") return jsonArray(item.Product?.taxes).find((tax) => String(tax.name).toLowerCase() === lower)?.type || "percentage"
    return item.Product?.Category?.tax_type || "percentage"
  }

  const groups = new Map()
  const add = (level, name, type, rate, amount) => {
    const key = `${level}|${String(name).toLowerCase()}`
    if (!groups.has(key)) groups.set(key, { tax_rule: name, level, tax_type: type, rate: rate == null ? null : Number(rate), tax_collected: 0 })
    groups.get(key).tax_collected = money(groups.get(key).tax_collected + amount)
  }
  const surcharge = new Map()
  for (const { figures } of completed) {
    if (figures.fully_refunded) continue
    for (const line of figures.lines) {
      const item = line.item
      const qty = Number(item.quantity || 0)
      const share = qty > 0 ? remainingQty(item) / qty : 0
      if (share <= 0) continue
      const taxes = jsonArray(item.line_taxes)
      if (taxes.length) {
        for (const tax of taxes) {
          const level = tax.level === "sales" ? "store" : tax.level
          const name = tax.name || "Tax"
          add(level, name, tax.type || typeOf(level, name, item), tax.rate, Number(tax.amount || 0) * share)
        }
      } else {
        // Older sales: only the three tax columns were kept.
        if (Number(item.sales_tax_amount) > 0) add("store", "Sales Tax", "percentage", null, Number(item.sales_tax_amount) * share)
        if (Number(item.product_tax_amount) > 0) add("product", "Product Tax", "percentage", null, Number(item.product_tax_amount) * share)
        if (Number(item.category_tax_amount) > 0) add("category", "Category Tax", "percentage", null, Number(item.category_tax_amount) * share)
      }
    }
    for (const method of PAYMENT_METHODS) {
      const amount = Number(figures.taxes.payment_method_tax[method] || 0)
      if (amount <= 0) continue
      const entry = surcharge.get(method) || { payments: 0, surcharge_collected: 0 }
      entry.payments += 1
      entry.surcharge_collected = money(entry.surcharge_collected + amount)
      surcharge.set(method, entry)
    }
  }

  let rules = [...groups.values()].sort((a, b) => b.tax_collected - a.tax_collected)
  if (f.tax_name) rules = rules.filter((rule) => String(rule.tax_rule).toLowerCase() === f.tax_name.toLowerCase())
  if (f.level) rules = rules.filter((rule) => rule.level === f.level)
  if (f.tax_type) rules = rules.filter((rule) => rule.tax_type === f.tax_type)
  rules = rules.map((rule, index) => ({ id: index + 1, ...rule }))

  const ruleOf = new Map(surchargeRules.map((rule) => [rule.method, rule]))
  const surcharges = [...surcharge.entries()]
    .map(([method, entry]) => ({
      id: method,
      method: method.toUpperCase(),
      surcharge_type: ruleOf.get(method)?.type || null,
      surcharge_value: ruleOf.get(method) ? Number(ruleOf.get(method).charges) : null,
      payments: entry.payments,
      surcharge_collected: entry.surcharge_collected,
    }))
    .sort((a, b) => b.surcharge_collected - a.surcharge_collected)
  return { rules, surcharges, surchargeTotal: sum(surcharges, "surcharge_collected") }
}
