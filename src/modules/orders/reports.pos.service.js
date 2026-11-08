import { Op } from "sequelize"
import { Order } from "./order.model.js"
import { OrderItem } from "./orderItem.model.js"
import { OrderRefund } from "./orderRefund.model.js"
import { Payment } from "../payments/payment.model.js"
import { Product } from "../catalog/product.model.js"
import { Category } from "../catalog/category.model.js"
import { ProductStock } from "../catalog/productStock.model.js"
import { StockMovement } from "../inventory/stockMovement.model.js"
import { StockTransfer } from "../inventory/stockTransfer.model.js"
import { StockTransferItem } from "../inventory/stockTransferItem.model.js"
import { Offer } from "../offers/offer.model.js"
import { OfferTarget } from "../offers/offerTarget.model.js"
import { Coupon } from "../coupons/coupon.model.js"
import { RegisterSession } from "../pos/registerSession.model.js"
import { Location } from "../locations/location.model.js"
import { User } from "../auth/user.model.js"
import { getStoreForManager } from "../stores/store.service.js"
import { expiryStatus } from "../catalog/product.service.js"
import { loadLocation } from "../catalog/productStock.service.js"
import { money } from "../commerce/pricing.service.js"
import { AppError } from "../../shared/errors/AppError.js"
import { PAYMENT_METHOD, PAYMENT_METHOD_LABEL } from "../../db/enums.js"
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

const PAYMENT_METHODS = PAYMENT_METHOD.filter((method) => method !== "mixed")
const METHOD_LABEL = PAYMENT_METHOD_LABEL

function emptyTaxes() {
  return {
    sales_tax: 0,
    product_tax: 0,
    category_tax: 0,
    payment_method_tax: { ...Object.fromEntries(PAYMENT_METHODS.map((method) => [method, 0])), total: 0 },
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
function lineFigures(order, item, opts = {}) {
  const qty = Number(item.quantity || 0)
  // opts.ignoreRefunds: the line as first sold, before any item refund.
  const left = opts.ignoreRefunds ? qty : remainingQty(item)
  const share = qty > 0 ? left / qty : 0
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
    units: money(left),
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
    cost: money(Number(item.cost_price || 0) * left),
  }
}

/**
 * What an order still counts for after its refunds. Payment-method tax kept = charged minus the
 * share the refunds gave back (a refund's tax = its line tax + its share of payment GST).
 */
function orderFigures(order, opts = {}) {
  const lines = (order.OrderItems || []).map((item) => ({ item, ...lineFigures(order, item, opts) }))
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

function liveOrders(orders, opts = {}) {
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
    const figures = orderFigures(order, opts)
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
            // The unit its quantities are in (bottle, kg, gram…).
            unit: item.unit || item.Product?.unit || null,
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
    // The four usual methods always; any other method once something was charged on it.
    ...PAYMENT_METHODS.filter((method) => ["cash", "card", "jazzcash", "easypaisa"].includes(method) || taxes.payment_method_tax[method] > 0).map((method) => ({
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
async function zReports(actor, query, scope, extra = {}) {
  // Register sessions are POS-only.
  if (normalizeChannel(query) === "web") {
    return { rows: [] }
  }
  const where = { store_id: actor.store_id }
  if (scope.location_id) where.location_id = scope.location_id
  if (scope.cashier_id) where.cashier_id = scope.cashier_id
  // Report filters: status (open | closed), one cashier.
  if (extra.status) where.status = extra.status
  if (extra.cashierId) where.cashier_id = extra.cashierId
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

  const built = sessions.map((row) => {
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
        batch_number: json.session_number ?? null,
        cashier_id: json.cashier_id || null,
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
    })
  // variance_only: closed batches whose counted cash is short or over.
  return { rows: extra.varianceOnly ? built.filter((row) => row.counted_cash != null && Number(row.variance) !== 0) : built }
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

async function inventoryReport(actor, query, scope, extra = {}) {
  const where = { store_id: actor.store_id }
  if (scope.location_id) where.location_id = scope.location_id
  // supplier: the products that came in from that supplier (their stock movements).
  if (extra.supplierId) {
    const bought = await StockMovement.findAll({ where: { store_id: actor.store_id, supplier_id: extra.supplierId }, attributes: ['product_id'], group: ['product_id'], raw: true })
    where.product_id = { [Op.in]: bought.map((row) => row.product_id) }
  }
  const store = await getStoreForManager(actor.store_id)
  const stocks = await ProductStock.findAll({
    where,
    include: [
      {
        model: Product,
        attributes: ["id", "title", "sku", "unit", "is_pack_product", "is_weight_based", "low_stock_threshold"],
        include: [{ model: Category, attributes: ["id", "name"] }],
      },
      { model: Location, attributes: ["id", "name", "location_id_int"] },
    ],
    order: [["qty", "ASC"]],
    limit: 2000,
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
  // In / out per product at each location (a stock row is one product at one location).
  const flowKey = (productId, locationId) => `${productId}|${locationId}`
  const flow = new Map()
  for (const move of moves) {
    const key = flowKey(move.product_id, move.location_id)
    const cur = flow.get(key) || { inn: 0, out: 0 }
    const next = movementBuckets(move.movement_type, move.qty)
    cur.inn = money(cur.inn + next.inn)
    cur.out = money(cur.out + next.out)
    flow.set(key, cur)
  }

  let rows = stocks.map((row) => {
      const json = row.toJSON()
      const delta = flow.get(flowKey(json.product_id, json.location_id)) || { inn: 0, out: 0 }
      const qty = Number(json.qty || 0)
      const threshold = json.low_stock_threshold ?? json.Product?.low_stock_threshold
      const product = json.Product
      return {
        id: json.id,
        product: product?.title || "—",
        sku: product?.sku || "—",
        category: product?.Category?.name || "—",
        location: json.Location?.name || "—",
        location_id: json.Location?.location_id_int ?? null,
        unit: product?.unit || null,
        // weight = sold by weight; else pack = a pack product; else loose.
        type: product?.is_weight_based ? "weight" : product?.is_pack_product ? "pack" : "loose",
        stock_in: delta.inn,
        stock_out: delta.out,
        current_stock: qty,
        // out = nothing left; low = at or under its low-stock alert; ok = above it.
        stock_status: qty <= 0 ? "out" : threshold != null && qty <= Number(threshold) ? "low" : "ok",
        // The soonest expiry of the stock: expired | critical | warning | ok, or none (no expiry date).
        expiry_date: json.expiry_date || null,
        expiry_status: json.expiry_date ? expiryStatus(json.expiry_date, store.expiry_warning_days, store.expiry_critical_days) : "none",
      }
    })
  if (extra.stockStatus) rows = rows.filter((row) => row.stock_status === extra.stockStatus)
  if (extra.expiryStatus) rows = rows.filter((row) => row.expiry_status === extra.expiryStatus)
  if (extra.type) rows = rows.filter((row) => row.type === extra.type)
  return { rows }
}

function prettyReason(reason) {
  return String(reason || "other")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

async function stockMovementReport(actor, query, scope, extra = {}) {
  const where = { store_id: actor.store_id }
  if (scope.location_id) where.location_id = scope.location_id
  if (scope.cashier_id) where.staff_id = scope.cashier_id
  if (extra.staffId) where.staff_id = extra.staffId
  if (extra.movementType) where.movement_type = extra.movementType
  if (extra.reason) where.reason = extra.reason
  if (extra.supplierId) where.supplier_id = extra.supplierId
  if (extra.productIds) where.product_id = { [Op.in]: extra.productIds }
  applyDateRange(where, query)
  if (where.placed_at) {
    where.created_at = where.placed_at
    delete where.placed_at
  }
  applyMovementChannel(where, query)
  const rows = await StockMovement.findAll({
    where,
    include: [
      { model: Product, attributes: ["id", "title", "sku", "unit"] },
      { model: User, as: "staff", attributes: ["id", "name"] },
      { model: Location, attributes: ["id", "name", "location_id_int"] },
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
        location: json.Location?.name || "—",
        location_id: json.Location?.location_id_int ?? null,
        type: String(json.movement_type || "").toUpperCase(),
        qty: Number(json.qty || 0),
        unit: json.Product?.unit || null,
        reason: prettyReason(json.reason),
        channel: json.channel || null,
        cashier: json.staff?.name || "System",
      }
    }),
  }
}

/**
 * Stock transfers in the range (sent from or arriving at the location shown): one row per product
 * per destination, with the summary of what left, what arrived and what is still on the way.
 */
async function transferReport(actor, query, scope, extra = {}) {
  const where = { store_id: actor.store_id }
  applyDateRange(where, query)
  if (where.placed_at) {
    where.created_at = where.placed_at
    delete where.placed_at
  }
  const transfers = await StockTransfer.findAll({
    where,
    include: [
      { model: Location, as: "fromLocation", attributes: ["id", "name", "location_id_int"] },
      { model: User, as: "createdBy", attributes: ["id", "name"] },
      {
        model: StockTransferItem,
        as: "items",
        include: [
          { model: Location, as: "toLocation", attributes: ["id", "name", "location_id_int"] },
          { model: Product, attributes: ["id", "title", "sku", "unit"] },
        ],
      },
    ],
    order: [["created_at", "DESC"]],
    limit: 300,
  })
  const rows = []
  const summary = { transfers: 0, lines: 0, units_sent: 0, units_received: 0, units_on_the_way: 0, units_cancelled: 0 }
  for (const transfer of transfers) {
    const json = transfer.toJSON()
    // A location's report: what it sent and what came to it.
    const items = (json.items || []).filter(
      (item) =>
        (!scope.location_id || json.from_location_id === scope.location_id || item.to_location_id === scope.location_id) &&
        // status: a line still pending counts as on the way.
        (!extra.status || (extra.status === "on_the_way" ? item.status === "on_the_way" || item.status === "pending" : item.status === extra.status)) &&
        (!extra.productIds || extra.productIds.includes(item.product_id))
    )
    if (!items.length) continue
    summary.transfers += 1
    for (const item of items) {
      const qty = Number(item.qty || 0)
      const received = Number(item.received_qty || 0)
      summary.lines += 1
      summary.units_sent = money(summary.units_sent + qty)
      summary.units_received = money(summary.units_received + received)
      if (item.status === "on_the_way" || item.status === "pending") summary.units_on_the_way = money(summary.units_on_the_way + qty)
      if (item.status === "cancelled") summary.units_cancelled = money(summary.units_cancelled + qty)
      rows.push({
        id: item.id,
        transfer: json.transfer_number,
        date: json.created_at,
        from: json.fromLocation?.name || "—",
        to: item.toLocation?.name || "—",
        direction: !scope.location_id ? null : json.from_location_id === scope.location_id ? "out" : "in",
        product: item.Product?.title || "—",
        sku: item.Product?.sku || "—",
        qty,
        received_qty: item.received_qty == null ? null : received,
        status: item.status,
        received_at: item.received_at || null,
        staff: json.createdBy?.name || "—",
        note: json.note || null,
      })
    }
  }
  return { summary, rows }
}

const DISCOUNT_SOURCE_LABEL = {
  product: "Product discount",
  category: "Category discount",
  "product+category": "Product + category discount",
  bulk_tier: "Bulk tier",
  offer: "Offer",
  custom: "Custom (till)",
  order: "Order discount",
  coupon: "Coupon",
  unknown: "Other",
}

/** A line's discount name: its offer, else the product / category discount it was sold with. */
function discountName(item) {
  const offer = offersOf(item)[0]
  if (offer?.name) return offer.name
  const parse = (value) => {
    if (!value) return null
    if (typeof value === "string") {
      try {
        return JSON.parse(value)
      } catch {
        return null
      }
    }
    return value
  }
  return parse(item.product_discount)?.name || parse(item.category_discount)?.name || null
}

const parseJson = (value) => {
  if (!value) return null
  if (typeof value === "string") {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }
  return value
}

/** Running now, not yet started, ended, or switched off. */
function windowStatus(isActive, start, end, now = new Date()) {
  if (!isActive) return "inactive"
  if (start && new Date(start) > now) return "scheduled"
  if (end && new Date(end) < now) return "expired"
  return "running"
}

const amountText = (type, value) =>
  type == null || value == null ? null : type === "percentage" ? `${Number(value)}%` : `Rs ${Number(value)}`

/**
 * Every discount entered in the system — offers, product discounts, category discounts and
 * coupons, running or not — with what each gave on the sales in the range.
 */
async function discountCatalog(actor, completed) {
  const storeId = actor.store_id
  const [offers, products, categories, coupons] = await Promise.all([
    Offer.findAll({ where: { store_id: storeId }, include: [{ model: OfferTarget }], order: [["offer_number", "ASC"]] }),
    Product.findAll({
      where: { store_id: storeId, discount_type: { [Op.ne]: null }, discount_value: { [Op.ne]: null } },
      attributes: ["id", "product_number", "title", "discount_type", "discount_value", "discount_name", "is_active"],
      order: [["product_number", "ASC"]],
    }),
    Category.findAll({
      where: { store_id: storeId, discount_type: { [Op.ne]: null }, discount_value: { [Op.ne]: null } },
      attributes: ["id", "category_number", "name", "discount_type", "discount_value", "discount_name", "is_active"],
      order: [["category_number", "ASC"]],
    }),
    Coupon.findAll({ where: { store_id: storeId }, order: [["created_at", "ASC"]] }),
  ])

  // What each discount gave in the range (orders, lines, amount).
  const use = new Map()
  const used = (key, orderId, amount) => {
    if (!(amount > 0)) return
    const row = use.get(key) || { orders: new Set(), lines: 0, amount: 0 }
    row.orders.add(orderId)
    row.lines += 1
    addMoney(row, "amount", amount)
    use.set(key, row)
  }
  for (const { order, figures } of completed) {
    for (const line of figures.lines) {
      const amount = Number(line.line_discount || 0)
      if (!(amount > 0)) continue
      const item = line.item
      const qty = Number(item.quantity || 0)
      const share = qty > 0 ? line.units / qty : 0
      const source = item.discount_source
      if (source === "offer" || offersOf(item).length) {
        used(`offer:${item.offer_id || offersOf(item)[0]?.id}`, order.id, amount)
      } else if (source === "product") {
        used(`product:${item.product_id}`, order.id, amount)
      } else if (source === "category") {
        used(`category:${item.category_id || item.Product?.category_id}`, order.id, amount)
      } else if (source === "product+category") {
        const own = money(Number(parseJson(item.product_discount)?.amount || 0) * share)
        used(`product:${item.product_id}`, order.id, own)
        used(`category:${item.category_id || item.Product?.category_id}`, order.id, money(amount - own))
      }
    }
    const coupon = Number(order.coupon_discount_amount || 0)
    if (coupon > 0 && order.coupon_code) used(`coupon:${String(order.coupon_code).toLowerCase()}`, order.id, coupon)
  }
  const usage = (key) => {
    const row = use.get(key)
    return row ? { used_orders: row.orders.size, used_lines: row.lines, discount_given: money(row.amount) } : { used_orders: 0, used_lines: 0, discount_given: 0 }
  }

  const rows = [
    ...offers.map((offer) => {
      const targets = offer.OfferTargets || []
      const products = targets.filter((t) => t.product_id).length
      const cats = targets.filter((t) => t.category_id).length
      return {
        kind: "offer",
        id: offer.offer_number,
        name: offer.name,
        type: offer.type,
        amount: offer.type === "bogo" ? `Buy ${offer.buy_qty} get ${offer.get_qty}` : amountText(offer.discount_type, offer.discount_value) || "Sale prices",
        applies_to: [products ? `${products} product${products === 1 ? "" : "s"}` : null, cats ? `${cats} categor${cats === 1 ? "y" : "ies"}` : null].filter(Boolean).join(", ") || "—",
        start_at: offer.start_at,
        end_at: offer.end_at,
        status: windowStatus(offer.is_active, offer.start_at, offer.end_at),
        ...usage(`offer:${offer.id}`),
        // Older lines name the offer by number only.
        ...(use.has(`offer:${offer.offer_number}`) && !use.has(`offer:${offer.id}`) ? usage(`offer:${offer.offer_number}`) : {}),
      }
    }),
    ...products.map((product) => ({
      kind: "product",
      id: product.product_number,
      name: product.discount_name || "Product discount",
      type: "product_discount",
      amount: amountText(product.discount_type, product.discount_value),
      applies_to: product.title,
      start_at: null,
      end_at: null,
      status: product.is_active ? "running" : "inactive",
      ...usage(`product:${product.id}`),
    })),
    ...categories.map((category) => ({
      kind: "category",
      id: category.category_number,
      name: category.discount_name || "Category discount",
      type: "category_discount",
      amount: amountText(category.discount_type, category.discount_value),
      applies_to: category.name,
      start_at: null,
      end_at: null,
      status: category.is_active ? "running" : "inactive",
      ...usage(`category:${category.id}`),
    })),
    ...coupons.map((coupon) => ({
      kind: "coupon",
      id: coupon.code,
      name: coupon.code,
      type: "coupon",
      amount: amountText(coupon.type, coupon.value),
      applies_to: "Whole order",
      start_at: coupon.start_date,
      end_at: coupon.end_date,
      status: windowStatus(coupon.is_active, coupon.start_date, coupon.end_date),
      ...usage(`coupon:${String(coupon.code).toLowerCase()}`),
    })),
  ]
  return rows
}

/**
 * Every discount given on the sales in the range, as kept on each sale (the discounts that were
 * running then, even if changed or deleted since): line discounts (product, category, offer,
 * bulk tier, custom) and order discounts / coupons, with totals per source; and each discounted
 * sale with its calculation (gross − line discounts − order discount − coupon = net, + tax = total).
 */
async function discountReport(actor, completed) {
  const lines = []
  const sales = []
  const bySource = new Map()
  const add = (source, amount, orderId) => {
    const row = bySource.get(source) || { source, label: DISCOUNT_SOURCE_LABEL[source] || source, lines: 0, orders: new Set(), amount: 0 }
    row.lines += 1
    row.orders.add(orderId)
    addMoney(row, "amount", amount)
    bySource.set(source, row)
  }
  for (const { order, figures } of completed) {
    const base = {
      order: order.order_number,
      date: order.placed_at,
      location: order.Location?.name || "—",
      cashier: order.cashier?.name || "—",
    }
    const saleLines = []
    for (const line of figures.lines) {
      const amount = Number(line.line_discount || 0)
      const source = line.item.discount_source && line.item.discount_source in DISCOUNT_SOURCE_LABEL ? line.item.discount_source : amount > 0 ? "unknown" : null
      const view = {
        product: line.item.title || "—",
        qty: line.units,
        unit_price: Number(line.item.unit_price || 0),
        gross: line.gross,
        discount: money(amount),
        source,
        source_label: source ? DISCOUNT_SOURCE_LABEL[source] : null,
        name: amount > 0 ? discountName(line.item) : null,
        net: money(line.gross - amount),
      }
      saleLines.push(view)
      if (!(amount > 0)) continue
      add(source, amount, order.id)
      lines.push({ ...base, id: `${order.id}-${line.item.id}`, product: view.product, qty: view.qty, source, source_label: view.source_label, name: view.name, gross: view.gross, amount: view.discount })
    }
    const orderDiscount = figures.fully_refunded ? 0 : Number(order.discount_amount || 0)
    const coupon = figures.fully_refunded ? 0 : Number(order.coupon_discount_amount || 0)
    if (orderDiscount > 0) {
      add("order", orderDiscount, order.id)
      lines.push({ ...base, id: `${order.id}-order`, product: "Whole order", qty: null, source: "order", source_label: DISCOUNT_SOURCE_LABEL.order, name: order.order_discount_type || null, gross: money(order.subtotal || 0), amount: money(orderDiscount) })
    }
    if (coupon > 0) {
      add("coupon", coupon, order.id)
      lines.push({ ...base, id: `${order.id}-coupon`, product: "Whole order", qty: null, source: "coupon", source_label: DISCOUNT_SOURCE_LABEL.coupon, name: order.coupon_code || null, gross: money(order.subtotal || 0), amount: money(coupon) })
    }
    const lineDiscount = money(saleLines.reduce((sum, line) => sum + line.discount, 0))
    if (lineDiscount > 0 || orderDiscount > 0 || coupon > 0) {
      sales.push({
        ...base,
        id: order.id,
        gross: figures.gross,
        line_discount: lineDiscount,
        order_discount: money(orderDiscount),
        coupon_discount: money(coupon),
        coupon_code: coupon > 0 ? order.coupon_code || null : null,
        discount: money(lineDiscount + orderDiscount + coupon),
        net: figures.net,
        tax: figures.taxes.total,
        total: figures.total,
        lines: saleLines,
      })
    }
  }
  const by_source = [...bySource.values()]
    .map(({ orders, ...row }) => ({ ...row, orders: orders.size }))
    .sort((x, y) => y.amount - x.amount)
  return {
    total: money(by_source.reduce((sum, row) => sum + row.amount, 0)),
    orders: sales.length,
    by_source,
    catalog: await discountCatalog(actor, completed),
    sales: sales.sort((x, y) => new Date(y.date) - new Date(x.date)),
    rows: lines.sort((x, y) => new Date(y.date) - new Date(x.date)),
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
  const [z_reports, inventory, stock_movement, stock_transfers, discounts] = await Promise.all([
    zReports(actor, scopedQuery, scope),
    inventoryReport(actor, scopedQuery, scope),
    stockMovementReport(actor, scopedQuery, scope),
    transferReport(actor, scopedQuery, scope),
    discountReport(actor, extras.completed),
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
    stock_transfers,
    discounts,
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

/**
 * The section builders, for GET /api/v1/reporting (the dashboard's plan-based reporting), so both
 * report the same figures. Nothing here changes the /reports endpoints.
 */
export const reportParts = {
  loadOrders,
  liveOrders,
  salesSummary,
  byProduct,
  byCategory,
  byLocation,
  paymentBreakdown,
  byCashier,
  byOffer,
  taxBreakdown,
  refundedOrders,
  cancelledOrders,
  zReports,
  inventoryReport,
  stockMovementReport,
  transferReport,
  discountReport,
}
