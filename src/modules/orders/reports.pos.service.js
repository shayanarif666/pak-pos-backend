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
import { loadLocation } from "../catalog/productStock.service.js"
import { money } from "../commerce/pricing.service.js"
import { AppError } from "../../shared/errors/AppError.js"
import {
  addMoney,
  applyDateRange,
  bucketKey,
  dateBound,
  normalizeChannel,
  orderWhere,
  remainingQty,
  reportScope,
  resolvePeriod,
} from "./reports.service.js"

const PAYMENT_METHODS = ["cash", "card", "jazzcash", "easypaisa"]
const METHOD_LABEL = { cash: "Cash", card: "Card", jazzcash: "JazzCash", easypaisa: "EasyPaisa" }

function emptyTaxes() {
  return {
    sales_tax: 0,
    product_tax: 0,
    category_tax: 0,
    payment_method_tax: { cash: 0, card: 0, jazzcash: 0, easypaisa: 0, total: 0 },
    total: 0,
  }
}

function addTaxes(target, next) {
  for (const key of ["sales_tax", "product_tax", "category_tax", "total"]) addMoney(target, key, next[key])
  for (const key of [...PAYMENT_METHODS, "total"]) {
    addMoney(target.payment_method_tax, key, next.payment_method_tax[key])
  }
}

/**
 * One order line, scaled to what is still sold after item refunds. The order discount (and
 * coupon) is spread over the lines by their subtotal — the same way refunds take it back.
 *   gross − line_discount − order_discount = net;  net + line taxes = total
 */
function lineFigures(order, item) {
  const qty = Number(item.quantity || 0)
  const share = qty > 0 ? remainingQty(item) / qty : 0
  const orderSubtotal = Number(order.subtotal || 0)
  const orderDiscount = Number(order.discount_amount || 0) + Number(order.coupon_discount_amount || 0)
  const lineSubtotal = Number(item.subtotal || 0)
  const gross = money(Number(item.unit_price || 0) * qty * share)
  const line_discount = money(Number(item.discount_amount || 0) * share)
  const order_discount = orderSubtotal > 0 ? money(orderDiscount * (lineSubtotal / orderSubtotal) * share) : 0
  const net = money(lineSubtotal * share - order_discount)
  const sales_tax = money(Number(item.sales_tax_amount || 0) * share)
  const product_tax = money(Number(item.product_tax_amount || 0) * share)
  const category_tax = money(Number(item.category_tax_amount || 0) * share)
  const tax = money(sales_tax + product_tax + category_tax)
  return {
    units: money(remainingQty(item)),
    gross,
    line_discount,
    order_discount,
    discount: money(line_discount + order_discount),
    net,
    sales_tax,
    product_tax,
    category_tax,
    tax,
    total: money(net + tax),
    cost: money(Number(item.cost_price || 0) * remainingQty(item)),
  }
}

/**
 * What an order still counts for after its refunds. Payment-method tax kept = charged minus the
 * share the refunds gave back (a refund's tax = its line tax + its share of payment GST).
 */
function orderFigures(order) {
  const lines = (order.OrderItems || []).map((item) => ({ item, ...lineFigures(order, item) }))
  const sum = (key) => money(lines.reduce((total, line) => total + Number(line[key] || 0), 0))
  const refunds = order.OrderRefunds || []
  const refunded = money(refunds.reduce((total, row) => total + Number(row.amount || 0), 0))
  const refundedTax = money(refunds.reduce((total, row) => total + Number(row.tax_amount || 0), 0))
  const lineTaxRefunded = money(
    (order.OrderItems || []).reduce((total, item) => {
      const qty = Number(item.quantity || 0)
      return total + (qty > 0 ? Number(item.tax_amount || 0) * (Number(item.refunded_qty || 0) / qty) : 0)
    }, 0)
  )
  const charged = Number(order.payment_gst_amount || 0)
  const paymentTaxKept = money(Math.max(0, charged - Math.max(0, refundedTax - lineTaxRefunded)))
  const keptShare = charged > 0 ? paymentTaxKept / charged : 0

  const taxes = emptyTaxes()
  taxes.sales_tax = sum("sales_tax")
  taxes.product_tax = sum("product_tax")
  taxes.category_tax = sum("category_tax")
  const splits = Array.isArray(order.tax_breakdown?.payment_gst) ? order.tax_breakdown.payment_gst : []
  if (splits.length) {
    for (const split of splits) {
      const method = String(split.method || "").toLowerCase()
      if (PAYMENT_METHODS.includes(method)) {
        addMoney(taxes.payment_method_tax, method, Number(split.gst_amount || 0) * keptShare)
      }
    }
  } else if (paymentTaxKept > 0 && PAYMENT_METHODS.includes(order.payment_method)) {
    addMoney(taxes.payment_method_tax, order.payment_method, paymentTaxKept)
  }
  taxes.payment_method_tax.total = paymentTaxKept
  taxes.total = money(taxes.sales_tax + taxes.product_tax + taxes.category_tax + paymentTaxKept)

  const anyLeft = lines.some((line) => line.units > 0)
  const shipping = anyLeft ? money(order.shipping_fee || 0) : 0
  const net = sum("net")
  return {
    lines,
    units: sum("units"),
    gross: sum("gross"),
    line_discount: sum("line_discount"),
    order_discount: sum("order_discount"),
    discount: sum("discount"),
    net,
    taxes,
    shipping,
    // What the store keeps: net goods + every tax + shipping.
    total: money(net + taxes.total + shipping),
    // What was charged at the till, before any refund.
    charged: money(order.total_amount || 0),
    // What actually came in (the payments) — udhaar left on the sale is not collected.
    collected: money(
      (order.Payments || [])
        .filter((row) => !row.status || row.status === "success")
        .reduce((total, row) => total + Number(row.amount || 0), 0)
    ),
    refunded,
    refunded_tax: refundedTax,
    cost: sum("cost"),
    fbr: order.fbr_invoice_enabled
      ? money(Number(order.fbr_tax_amount || 0) * (Number(order.total_amount) > 0 ? Math.max(0, 1 - refunded / Number(order.total_amount)) : 0))
      : 0,
    fully_refunded: !anyLeft,
  }
}

function liveOrders(orders) {
  const completed = []
  let void_orders = 0
  let cancelled_orders = 0
  let refunded_orders = 0
  let refunded_items = 0
  let refunded_amount = 0
  let refunded_tax = 0

  for (const order of orders) {
    if (order.order_status === "voided") {
      void_orders += 1
      continue
    }
    if (order.order_status === "cancelled") {
      cancelled_orders += 1
      continue
    }
    const figures = orderFigures(order)
    refunded_items = money(
      refunded_items + (order.OrderItems || []).reduce((sum, item) => sum + Number(item.refunded_qty || 0), 0)
    )
    refunded_amount = money(refunded_amount + figures.refunded)
    refunded_tax = money(refunded_tax + figures.refunded_tax)
    if (order.order_status === "refunded") refunded_orders += 1
    completed.push({ order, figures, refund: { amount: figures.refunded, tax: figures.refunded_tax } })
  }

  return { completed, void_orders, cancelled_orders, refunded_orders, refunded_items, refunded_amount, refunded_tax }
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

/**
 * Sales summary, after refunds:
 *   gross_sales − line_discounts − order_discounts = net_sales
 *   net_sales + taxes.total (+ shipping) = total_sales
 *   total_collected (what the payments brought in) + on_credit (udhaar) − refunds = total_sales
 */
function salesSummary(completed, extras, query) {
  const trend = new Map()
  const totals = {
    orders: 0,
    units_sold: 0,
    gross_sales: 0,
    line_discounts: 0,
    order_discounts: 0,
    discounts: 0,
    net_sales: 0,
    taxes: emptyTaxes(),
    shipping: 0,
    total_sales: 0,
    total_collected: 0,
    // Udhaar: sold but not yet paid (charged − payments), before refunds.
    on_credit: 0,
    refunds: extras.refunded_amount,
    refunded_tax: extras.refunded_tax,
    refunded_orders: extras.refunded_orders,
    refunded_items: extras.refunded_items,
    voided_orders: extras.void_orders,
    cancelled_orders: extras.cancelled_orders,
    cost: 0,
    // Line discounts split by where they came from (lines sold before this was kept: unknown).
    discounts_by_source: {
      product: 0,
      category: 0,
      "product+category": 0,
      bulk_tier: 0,
      offer: 0,
      custom: 0,
      unknown: 0,
    },
  }

  for (const { order, figures } of completed) {
    totals.total_collected = money(totals.total_collected + figures.collected)
    totals.on_credit = money(totals.on_credit + Math.max(0, figures.charged - figures.collected))
    if (figures.fully_refunded) continue
    totals.orders += 1
    totals.units_sold = money(totals.units_sold + figures.units)
    addMoney(totals, "gross_sales", figures.gross)
    addMoney(totals, "line_discounts", figures.line_discount)
    addMoney(totals, "order_discounts", figures.order_discount)
    addMoney(totals, "discounts", figures.discount)
    addMoney(totals, "net_sales", figures.net)
    addMoney(totals, "shipping", figures.shipping)
    addMoney(totals, "total_sales", figures.total)
    addMoney(totals, "cost", figures.cost)
    addTaxes(totals.taxes, figures.taxes)
    for (const line of figures.lines) {
      if (!(Number(line.line_discount) > 0)) continue
      const source = line.item.discount_source
      const key = source && source in totals.discounts_by_source ? source : "unknown"
      addMoney(totals.discounts_by_source, key, line.line_discount)
    }

    const bucket = trendBucket(order.placed_at, query)
    if (!trend.has(bucket)) trend.set(bucket, { bucket, sales: 0, orders: 0 })
    const row = trend.get(bucket)
    row.orders += 1
    addMoney(row, "sales", figures.total)
  }

  const payments = paymentBreakdown(completed)
  return {
    totals: {
      ...totals,
      tax: totals.taxes.total,
      // Older field names kept for existing screens.
      revenue: totals.net_sales,
      tax_collection: legacyTaxCollection(totals.taxes),
      gross_profit: money(totals.net_sales - totals.cost),
      avg_order_value: totals.orders ? money(totals.total_sales / totals.orders) : 0,
      payments_net: payments.totals.net_amount,
    },
    trend: [...trend.entries()]
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([, row]) => row),
    payments: payments.rows,
  }
}

function legacyTaxCollection(taxes) {
  return {
    product_tax: taxes.product_tax,
    category_tax: taxes.category_tax,
    default_store_tax: taxes.sales_tax,
    payment_gst: taxes.payment_method_tax.total,
    payment_gst_cash: taxes.payment_method_tax.cash,
    payment_gst_card: taxes.payment_method_tax.card,
    payment_gst_jazzcash: taxes.payment_method_tax.jazzcash,
    payment_gst_easypaisa: taxes.payment_method_tax.easypaisa,
    total: taxes.total,
  }
}

function withPercents(rows, valueKey) {
  const total = rows.reduce((sum, row) => sum + Number(row[valueKey] || 0), 0)
  return rows.map((row) => ({
    ...row,
    percent: total > 0 ? Math.round((Number(row[valueKey] || 0) / total) * 100) : 0,
  }))
}

function emptyLineRow(extra) {
  return {
    ...extra,
    units_sold: 0,
    gross_sales: 0,
    discounts: 0,
    net_sales: 0,
    sales_tax: 0,
    product_tax: 0,
    category_tax: 0,
    tax: 0,
    total_sales: 0,
  }
}

function addLine(row, line) {
  row.units_sold = money(row.units_sold + line.units)
  addMoney(row, "gross_sales", line.gross)
  addMoney(row, "discounts", line.discount)
  addMoney(row, "net_sales", line.net)
  addMoney(row, "sales_tax", line.sales_tax)
  addMoney(row, "product_tax", line.product_tax)
  addMoney(row, "category_tax", line.category_tax)
  addMoney(row, "tax", line.tax)
  addMoney(row, "total_sales", line.total)
}

/** Per product: units, gross, discounts, net, each line tax, total (payment-method tax is per bill, see tax_breakdown). */
function offersOf(item) {
  const value = item.offers
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

function freeUnitsKept(item, offer, unitsKept) {
  const free = Number(item.free_qty || 0)
  if (!(free > 0)) return 0
  const buy = Number(offer.buy_qty), get = Number(offer.get_qty)
  if (buy > 0 && get > 0) return Math.min(free, Math.floor(unitsKept / (buy + get)) * get)
  const qty = Number(item.quantity || 0)
  return qty > 0 ? Math.round((free * unitsKept) / qty) : 0
}

/**
 * Each offer that priced a sold line: how many orders and units it was on, units given free
 * (BOGO), the discount it gave and the sales of those lines. Refunded units are left out.
 */
function byOffer(completed) {
  const groups = new Map()
  for (const { order, figures } of completed) {
    for (const line of figures.lines) {
      if (line.units <= 0) continue
      const qty = Number(line.item.quantity || 0)
      const share = qty > 0 ? line.units / qty : 0
      for (const offer of offersOf(line.item)) {
        const key = offer.id ?? offer.name
        if (!groups.has(key)) {
          groups.set(key, {
            offer: { id: offer.id ?? null, name: offer.name || null, type: offer.type || null },
            orderIds: new Set(),
            units: 0,
            free_units: 0,
            discount_given: 0,
            sales: 0,
          })
        }
        const row = groups.get(key)
        row.orderIds.add(order.id)
        row.units = money(row.units + line.units)
        // BOGO: whole free units still with the customer (refunded units leave fewer full groups).
        row.free_units = money(row.free_units + freeUnitsKept(line.item, offer, line.units))
        addMoney(row, "discount_given", line.line_discount)
        addMoney(row, "sales", line.total)
      }
    }
  }
  const rows = [...groups.values()]
    .map(({ orderIds, ...row }) => ({ ...row, orders: orderIds.size }))
    .sort((a, b) => Number(b.discount_given) - Number(a.discount_given))
  return {
    rows,
    totals: {
      offers: rows.length,
      discount_given: money(rows.reduce((sum, row) => sum + Number(row.discount_given), 0)),
      sales: money(rows.reduce((sum, row) => sum + Number(row.sales), 0)),
    },
  }
}

function byProduct(completed) {
  const groups = new Map()
  for (const { figures } of completed) {
    for (const line of figures.lines) {
      if (line.units <= 0) continue
      const { item } = line
      const key = item.product_id || `custom:${item.title}`
      if (!groups.has(key)) {
        groups.set(
          key,
          emptyLineRow({
            id: key,
            product: item.Product?.title || item.title,
            category: item.Product?.Category?.name || item.custom_category || (item.product_id ? "Uncategorized" : "Custom"),
          })
        )
      }
      addLine(groups.get(key), line)
    }
  }
  return {
    rows: withPercents(
      [...groups.values()].sort((a, b) => Number(b.total_sales) - Number(a.total_sales)),
      "total_sales"
    ),
  }
}

function byCategory(completed) {
  const groups = new Map()
  for (const { figures } of completed) {
    for (const line of figures.lines) {
      if (line.units <= 0) continue
      const { item } = line
      const name = item.Product?.Category?.name || item.custom_category || (item.product_id ? "Uncategorized" : "Custom")
      if (!groups.has(name)) groups.set(name, emptyLineRow({ category: name }))
      addLine(groups.get(name), line)
    }
  }
  return {
    rows: withPercents(
      [...groups.values()].sort((a, b) => Number(b.total_sales) - Number(a.total_sales)),
      "total_sales"
    ),
  }
}

/** Per payment method: what was taken, the refunds given back (spread over the order's payments), net. */
function paymentBreakdown(completed) {
  const groups = new Map()
  const rowOf = (method) => {
    const key = String(method || "other").toUpperCase()
    if (!groups.has(key)) {
      groups.set(key, { method: key, transactions: 0, gross_amount: 0, tax: 0, refunds: 0, net_amount: 0 })
    }
    return groups.get(key)
  }
  for (const { order, figures } of completed) {
    const payments = (order.Payments || []).filter((row) => !row.status || row.status === "success")
    const paid = payments.reduce((sum, row) => sum + Number(row.amount || 0), 0)
    for (const payment of payments) {
      const row = rowOf(payment.method)
      row.transactions += 1
      addMoney(row, "gross_amount", payment.amount)
      addMoney(row, "tax", payment.tax_amount)
    }
    // Refunds go back the way each refund says (card to card, cash from the drawer); the udhaar
    // part (credit) is no payment method's money. Older refunds without that split: by share.
    for (const refund of order.OrderRefunds || []) {
      const parts = Array.isArray(refund.payments) ? refund.payments : null
      if (parts) {
        for (const part of parts) {
          if (part.method === "credit") continue
          const row = rowOf(part.method)
          addMoney(row, "refunds", part.amount)
          addMoney(row, "tax", -Number(part.payment_tax_amount || 0))
        }
      } else if (paid > 0) {
        for (const payment of payments) addMoney(rowOf(payment.method), "refunds", Number(refund.amount || 0) * (Number(payment.amount) / paid))
      } else {
        addMoney(rowOf(order.payment_method), "refunds", refund.amount)
      }
    }
  }
  const rows = withPercents(
    [...groups.values()]
      .map((row) => ({ ...row, net_amount: money(Math.max(0, Number(row.gross_amount) - Number(row.refunds))) }))
      .sort((a, b) => Number(b.net_amount) - Number(a.net_amount)),
    "net_amount"
  )
  return {
    rows,
    totals: {
      transactions: rows.reduce((sum, row) => sum + row.transactions, 0),
      gross_amount: money(rows.reduce((sum, row) => sum + Number(row.gross_amount), 0)),
      tax: money(rows.reduce((sum, row) => sum + Number(row.tax), 0)),
      refunds: money(rows.reduce((sum, row) => sum + Number(row.refunds), 0)),
      net_amount: money(rows.reduce((sum, row) => sum + Number(row.net_amount), 0)),
    },
  }
}

/** Per cashier: orders, what they charged, discounts and tax in it, refunds, net. */
function byCashier(completed) {
  const groups = new Map()
  for (const { order, figures } of completed) {
    const id = order.cashier_id || "unknown"
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        cashier: order.cashier?.name || "Unknown",
        orders: 0,
        total_sales: 0,
        discounts: 0,
        tax: 0,
        refunds: 0,
        net_sales: 0,
      })
    }
    const row = groups.get(id)
    row.orders += 1
    addMoney(row, "total_sales", figures.charged)
    addMoney(row, "discounts", money(Number(order.line_discount_amount || 0) + Number(order.discount_amount || 0) + Number(order.coupon_discount_amount || 0)))
    addMoney(row, "tax", order.tax_amount)
    addMoney(row, "refunds", figures.refunded)
    row.net_sales = money(Math.max(0, row.total_sales - row.refunds))
  }
  return { rows: [...groups.values()].sort((a, b) => Number(b.net_sales) - Number(a.net_sales)) }
}

/** Every tax kept after refunds: Sales Tax, Product / Category Level Tax, Payment Method Tax. */
function taxBreakdown(completed) {
  const taxes = emptyTaxes()
  let net_sales = 0
  let total_sales = 0
  let fbr = 0
  let orders = 0
  for (const { figures } of completed) {
    if (figures.fully_refunded) continue
    orders += 1
    addTaxes(taxes, figures.taxes)
    net_sales = money(net_sales + figures.net)
    total_sales = money(total_sales + figures.total)
    fbr = money(fbr + figures.fbr)
  }
  const rows = [
    { id: "sales_tax", tax_rule: "Sales Tax", tax_collected: taxes.sales_tax },
    { id: "product_tax", tax_rule: "Product Level Tax", tax_collected: taxes.product_tax },
    { id: "category_tax", tax_rule: "Category Level Tax", tax_collected: taxes.category_tax },
    ...PAYMENT_METHODS.map((method) => ({
      id: `payment_tax_${method}`,
      tax_rule: `Payment Method Tax (${METHOD_LABEL[method]})`,
      tax_collected: taxes.payment_method_tax[method],
    })),
    { id: "payment_tax", tax_rule: "Payment Method Tax (total)", tax_collected: taxes.payment_method_tax.total },
    { id: "total", tax_rule: "Total Tax", tax_collected: taxes.total },
  ]
  return {
    totals: {
      orders,
      net_sales,
      tax_collected: taxes.total,
      total_sales,
      taxes,
      tax_collection: legacyTaxCollection(taxes),
      // Reported to FBR (already part of the taxes above, not an extra charge).
      fbr_reported: fbr,
    },
    rows,
  }
}

/** Refunded orders: every refund (complete = whole order, partial = some items). */
function refundedOrders(orders) {
  const rows = []
  for (const order of orders) {
    for (const refund of order.OrderRefunds || []) {
      rows.push({
        id: refund.refund_number,
        order_number: order.order_number,
        refund_type: refund.refund_type || "partial",
        date: refund.created_at || order.placed_at,
        amount: money(Number(refund.amount || 0) - Number(refund.tax_amount || 0)),
        tax: money(refund.tax_amount || 0),
        total: money(refund.amount || 0),
        reason: refund.reason || "",
        cashier: order.cashier?.name || "—",
      })
    }
  }
  rows.sort((a, b) => new Date(b.date) - new Date(a.date))
  const sum = (key) => money(rows.reduce((total, row) => total + Number(row[key] || 0), 0))
  return {
    rows,
    totals: {
      refunds: rows.length,
      complete: rows.filter((row) => row.refund_type === "complete").length,
      partial: rows.filter((row) => row.refund_type === "partial").length,
      orders: new Set(rows.map((row) => row.order_number)).size,
      amount: sum("amount"),
      tax: sum("tax"),
      total: sum("total"),
    },
  }
}

/** Cancelled / voided orders: the sales that did not go through. */
function cancelledOrders(orders) {
  const rows = orders
    .filter((order) => order.order_status === "cancelled" || order.order_status === "voided")
    .map((order) => ({
      id: order.order_number,
      status: order.order_status,
      date: order.updated_at || order.placed_at,
      amount: money(order.total_amount || 0),
      reason: order.void_reason || order.cancel_reason || "",
      cashier: order.cashier?.name || "—",
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
  return {
    rows,
    totals: {
      orders: rows.length,
      voided: rows.filter((row) => row.status === "voided").length,
      cancelled: rows.filter((row) => row.status === "cancelled").length,
      amount: money(rows.reduce((total, row) => total + Number(row.amount), 0)),
    },
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
    where: orderWhere(actor, query, ["completed", "partial_refunded", "voided", "refunded", "cancelled"]),
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

/**
 * Z-reports (batch history): each batch worked out from its own sales — orders, gross,
 * discounts, net, tax, refunds, total, takings per payment method, and the drawer:
 * expected cash = opening + cash in − cash out + cash taken − cash refunds; variance = counted − expected.
 */
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
  const orders = sessions.length
    ? await Order.findAll({
        where: {
          store_id: actor.store_id,
          register_session_id: { [Op.in]: sessions.map((row) => row.id) },
          order_status: { [Op.in]: ["completed", "partial_refunded", "refunded"] },
        },
        include: [{ model: OrderItem }, { model: Payment }, { model: OrderRefund }],
      })
    : []
  const bySession = new Map()
  for (const order of orders) {
    const list = bySession.get(order.register_session_id) || []
    list.push({ order, figures: orderFigures(order) })
    bySession.set(order.register_session_id, list)
  }

  return {
    rows: sessions.map((row) => {
      const json = row.toJSON()
      const sold = bySession.get(json.id) || []
      const sum = (key) => money(sold.reduce((total, entry) => total + Number(entry.figures[key] || 0), 0))
      const kept = sold.filter((entry) => !entry.figures.fully_refunded)
      const keptSum = (fn) => money(kept.reduce((total, entry) => total + Number(fn(entry.figures) || 0), 0))
      const methods = paymentBreakdown(sold).rows
      const takings = (method) => methods.find((m) => m.method === method.toUpperCase())
      const cashRow = takings("cash")
      const expected = money(
        Number(json.opening_cash || 0) +
          Number(json.cash_in || 0) -
          Number(json.cash_out || 0) +
          Number(cashRow?.net_amount || 0)
      )
      const counted = json.counted_cash == null ? null : Number(json.counted_cash)
      return {
        id: json.id,
        session_id: shortSessionId(json.id),
        date_time: json.opened_at,
        closed_at: json.closed_at || null,
        status: json.status === "open" ? "OPEN" : "CLOSED",
        cashier: json.cashier?.name || "—",
        opening_amount: money(json.opening_cash || 0),
        orders: sold.length,
        gross_sales: keptSum((f) => f.gross),
        discounts: keptSum((f) => f.discount),
        net_sales: keptSum((f) => f.net),
        tax: keptSum((f) => f.taxes.total),
        refunds: sum("refunded"),
        total_sales: keptSum((f) => f.total),
        cash_sales: money(cashRow?.net_amount || 0),
        card_sales: money(takings("card")?.net_amount || 0),
        jazzcash_sales: money(takings("jazzcash")?.net_amount || 0),
        easypaisa_sales: money(takings("easypaisa")?.net_amount || 0),
        cash_in: money(json.cash_in || 0),
        cash_out: money(json.cash_out || 0),
        expected_cash: expected,
        counted_cash: counted,
        variance: counted == null ? 0 : money(counted - expected),
        // Older field name kept for existing screens.
        sales: keptSum((f) => f.total),
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

async function buildPosReports(actor, query = {}, { withLocations = false } = {}) {
  const period = resolvePeriod(query)
  const channel = normalizeChannel(query)
  const scopedQuery = { ...query, channel: channel || undefined }
  const scope = reportScope(actor, scopedQuery)
  const orders = await loadOrders(actor, scopedQuery)
  const extras = liveOrders(orders)
  const sales_summary = salesSummary(extras.completed, extras, scopedQuery)
  const payments = paymentBreakdown(extras.completed)
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
    refunded_orders: refundedOrders(orders),
    cancelled_orders: cancelledOrders(orders),
    by_cashier: byCashier(extras.completed),
    by_offer: byOffer(extras.completed),
    tax_breakdown: taxBreakdown(extras.completed),
    ...(withLocations ? { by_location: byLocation(extras.completed) } : {}),
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

/** Per location (all-locations report): orders, gross, discounts, net, tax, refunds, total. */
function byLocation(completed) {
  const groups = new Map()
  for (const { order, figures } of completed) {
    const key = order.location_id || "none"
    if (!groups.has(key)) {
      groups.set(key, {
        location: { id: order.location_id_int ?? null, name: order.Location?.name || null },
        orders: 0,
        gross_sales: 0,
        discounts: 0,
        net_sales: 0,
        tax: 0,
        refunds: 0,
        total_sales: 0,
      })
    }
    const row = groups.get(key)
    addMoney(row, "refunds", figures.refunded)
    if (figures.fully_refunded) continue
    row.orders += 1
    addMoney(row, "gross_sales", figures.gross)
    addMoney(row, "discounts", figures.discount)
    addMoney(row, "net_sales", figures.net)
    addMoney(row, "tax", figures.taxes.total)
    addMoney(row, "total_sales", figures.total)
  }
  return {
    rows: withPercents(
      [...groups.values()].sort((a, b) => Number(a.location.id ?? 0) - Number(b.location.id ?? 0)),
      "total_sales"
    ),
  }
}

/** The report with only period, locationId, from, to in front of its sections. */
function reportHead(report, locationId) {
  const { period, channel: _channel, scope: _scope, from, to, ...sections } = report
  return { period, locationId, from, to, ...sections }
}

/** GET /reports/all-locations — store admin: every location together, plus by_location. */
export async function allLocationsReport(actor, query = {}) {
  await getStoreForManager(actor.store_id)
  if (actor.role !== "store_admin") throw new AppError("Only the store admin can see every location", 403)
  const { location_id: _a, locationId: _b, ...rest } = query
  const report = await buildPosReports(actor, rest, { withLocations: true })
  return reportHead(report, null)
}

/**
 * GET /reports/location?locationId= — one location (number or UUID). A store admin picks any
 * location; a manager / cashier gets their own (another one is refused).
 */
export async function locationReport(actor, query = {}) {
  await getStoreForManager(actor.store_id)
  const ref = query.locationId ?? query.location_id
  let location
  if (ref != null && String(ref).trim() !== "") {
    location = await loadLocation(actor.store_id, String(ref).trim())
  } else if (actor.role !== "store_admin" && actor.location_id) {
    location = await loadLocation(actor.store_id, actor.location_id)
  } else {
    throw new AppError("locationId is required", 400)
  }
  if (actor.role !== "store_admin" && location.id !== actor.location_id) {
    throw new AppError("You can only see the report of your own location", 403)
  }
  const { locationId: _ref, ...rest } = query
  const report = await buildPosReports(actor, { ...rest, location_id: location.id })
  return reportHead(report, location.location_id_int)
}
