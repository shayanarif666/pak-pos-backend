/**
 * Receipt (invoice) shape for the POS — pure builders with no DB access, so they can be unit
 * tested. posReceipt() in posResponses.js loads the rows and the lookups, then calls
 * buildReceiptView().
 *
 * Every figure comes from what was saved when the sale was placed (order, order_items snapshot,
 * order.tax_breakdown, payments), never from the current catalog, so a receipt does not change
 * when a product's price, tax or name changes later.
 */

const num = (value) => (value == null ? null : Number(value))
const money = (value) => Number(Number(value || 0).toFixed(2))

function parseJson(value, fallback) {
  if (value == null) return fallback
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

/** The taxes charged on one line, by source: product taxes, category tax, store sales tax. */
export function lineTaxes(item, { categoryTaxName = null, salesTaxRate = null } = {}) {
  const taxes = []
  for (const tax of parseJson(item.product_taxes, []) || []) {
    if (!(Number(tax?.amount) > 0)) continue
    taxes.push({
      source: "product",
      name: tax.name || "Tax",
      type: tax.type || null,
      value: num(tax.value),
      amount: money(tax.amount),
    })
  }
  if (Number(item.category_tax_amount) > 0) {
    taxes.push({
      source: "category",
      name: categoryTaxName || "Category Tax",
      type: item.category_tax_type || null,
      value: num(item.category_tax_value),
      amount: money(item.category_tax_amount),
    })
  }
  if (Number(item.sales_tax_amount) > 0) {
    taxes.push({
      source: "sales_tax",
      name: "Sales Tax",
      type: "percentage",
      value: num(salesTaxRate),
      amount: money(item.sales_tax_amount),
    })
  }
  return taxes
}

/**
 * One sold line. lookups.product(id) -> { id, title, sku, unit } | null and
 * lookups.productCategory(id) -> { id, name, tax_name } | null.
 */
export function receiptItemView(item, lookups, { salesTaxRate = null } = {}) {
  const discount = money(item.discount_amount)
  const taxable = money(item.subtotal)
  const taxAmount = money(item.tax_amount)
  const isProduct = Boolean(item.product_id)
  const productRef = isProduct ? lookups.product(item.product_id) : null
  const category = isProduct ? lookups.productCategory(item.product_id) : null

  return {
    id: item.item_number,
    item_type: isProduct ? "product" : "custom",
    product_id: productRef?.id ?? null,
    // As sold: the title / sku / unit saved on the line (the product may have changed since).
    title: item.title,
    sku: item.sku || productRef?.sku || null,
    unit: item.unit || productRef?.unit || null,
    category: isProduct ? category?.name || null : item.custom_category || null,
    is_weight_based: Boolean(item.is_weight_based),
    weight: num(item.weight),
    qty_packs: num(item.qty_packs),
    qty: num(item.quantity),
    refunded_qty: num(item.refunded_qty) ?? 0,
    unit_price: num(item.unit_price),
    gross_amount: money(taxable + discount),
    discount_amount: discount,
    taxable_amount: taxable,
    taxes: lineTaxes(item, { categoryTaxName: category?.tax_name || null, salesTaxRate }),
    tax_amount: taxAmount,
    total: money(taxable + taxAmount),
  }
}

/**
 * Each payment: the split saved in order.tax_breakdown.payment_gst (bill share, payment GST,
 * paid, change), with the transaction number of its payment row. Payment rows are created in
 * the same order as the splits that have an amount, so they are matched by position.
 */
export function receiptPaymentsView(order, paymentRows) {
  const breakdown = parseJson(order?.tax_breakdown, {}) || {}
  const splits = (Array.isArray(breakdown.payment_gst) ? breakdown.payment_gst : []).filter(
    (row) => Number(row?.amount) > 0
  )
  const rows = [...(paymentRows || [])].sort(
    (a, b) => Number(a.transaction_number || 0) - Number(b.transaction_number || 0)
  )

  if (!splits.length) {
    // Older orders without saved splits: show the payment rows as they are.
    return rows.map((row) => ({
      transaction_id: row.transaction_number ?? null,
      method: row.method,
      bill_share: money(Number(row.amount) - Number(row.tax_amount || 0)),
      payment_tax_percent: null,
      payment_tax_amount: money(row.tax_amount),
      amount: money(row.amount),
      paid: money(row.amount),
      change: 0,
      status: row.status || null,
    }))
  }

  return splits.map((split, index) => {
    const row = rows[index] && rows[index].method === split.method ? rows[index] : rows.find((r) => r.method === split.method)
    return {
      transaction_id: row?.transaction_number ?? null,
      method: split.method,
      bill_share: num(split.bill_share),
      payment_tax_percent: num(split.gst_percent),
      payment_tax_amount: num(split.gst_amount) ?? 0,
      amount: num(split.amount),
      paid: num(split.paid ?? split.amount),
      change: num(split.change) ?? 0,
      status: row?.status || null,
    }
  })
}

/** Totals of the sale, every discount and tax shown on its own. */
export function receiptSummaryView(order, receipt, items) {
  const breakdown = parseJson(order?.tax_breakdown, {}) || {}
  const lineGross = money(items.reduce((sum, item) => sum + item.gross_amount, 0))
  const lineDiscount = money(items.reduce((sum, item) => sum + item.discount_amount, 0))

  const itemsDiscount = Number(order?.line_discount_amount) > 0 ? money(order.line_discount_amount) : lineDiscount
  const orderDiscount = money(order?.discount_amount)
  const couponDiscount = money(order?.coupon_discount_amount)
  const productTax = money(order?.product_tax_amount)
  const categoryTax = money(order?.category_tax_amount)
  const salesTax = money(order?.sales_tax_amount)
  const itemsTax = money(items.reduce((sum, item) => sum + item.tax_amount, 0))
  const paymentGst = money(order?.payment_gst_amount)

  return {
    gross_amount: Number(order?.gross_amount) > 0 ? money(order.gross_amount) : lineGross,
    items_discount: itemsDiscount,
    order_discount: orderDiscount,
    coupon_code: order?.coupon_code || null,
    coupon_discount: couponDiscount,
    total_discount: money(itemsDiscount + orderDiscount + couponDiscount),
    subTotal: num(order?.subtotal ?? receipt.subtotal),
    product_tax: productTax,
    category_tax: categoryTax,
    sales_tax_rate: num(order?.sales_tax_rate ?? breakdown.sales_tax_rate),
    sales_tax: salesTax,
    items_tax: itemsTax,
    payment_gst: paymentGst,
    fbr_invoice_enabled: Boolean(order?.fbr_invoice_enabled),
    fbr_fee: num(order?.fbr_tax_amount) ?? 0,
    shipping_fee: num(order?.shipping_fee ?? receipt.shipping_fee) ?? 0,
    tax_amount: num(receipt.tax_amount),
    total: num(receipt.total_amount),
    amount_paid: num(order?.amount_paid) ?? 0,
    change_due: num(order?.change_due) ?? 0,
  }
}

/**
 * The full receipt. The first fields keep the shape the POS already reads (id, location, staff,
 * order { id, status }, transaction, subTotal, discount_amount, tax_breakdown, tax_amount, total,
 * issued_at); the order's details, items, payments and summary are added next to them.
 */
export function buildReceiptView({ receipt, order, paymentRows, lookups, currency }) {
  const breakdown = parseJson(order?.tax_breakdown, {}) || {}
  const salesTaxRate = order?.sales_tax_rate ?? breakdown.sales_tax_rate ?? null
  const items = [...(order?.OrderItems || [])]
    .sort((a, b) => a.item_number - b.item_number)
    .map((item) => receiptItemView(item, lookups, { salesTaxRate }))
  const payments = receiptPaymentsView(order, paymentRows)
  const summary = receiptSummaryView(order, receipt, items)

  const firstPayment = receipt.payment_id
    ? (paymentRows || []).find((row) => row.id === receipt.payment_id)
    : null
  // Only GST that was actually charged (a method's rate shows only when tax applied).
  const gst = (breakdown.payment_gst || []).find((row) => Number(row.gst_amount) > 0)

  return {
    id: receipt.receipt_number,
    location: lookups.location(receipt.location_id),
    staff: lookups.staff(receipt.cashier_id),
    customer: order ? lookups.customer(order.customer_id) : null,
    order: order
      ? {
          id: order.order_number,
          status: order.order_status,
          channel: order.channel,
          is_custom: Boolean(order.is_custom),
          batch: lookups.batch(order.register_session_id),
          payment_method: order.payment_method,
          payment_status: order.payment_status,
          placed_at: order.placed_at,
          cancel_reason: order.cancel_reason || order.void_reason || null,
        }
      : null,
    transaction: firstPayment ? { id: firstPayment.transaction_number, method: firstPayment.method } : null,
    subTotal: num(receipt.subtotal),
    discount_amount: num(receipt.discount_amount),
    tax_breakdown: {
      payment_gst: gst ? `${Number(gst.gst_percent)}%` : "0%",
      fbr_fee: num(order?.fbr_tax_amount) ?? 0,
      product_tax: summary.product_tax,
      category_tax: summary.category_tax,
      sales_tax_rate: summary.sales_tax_rate,
      sales_tax: summary.sales_tax,
      payment_gst_amount: summary.payment_gst,
    },
    tax_amount: num(receipt.tax_amount),
    total: num(receipt.total_amount),
    items,
    payments,
    summary,
    issued_at: receipt.issued_at,
    currency: currency || "PKR",
  }
}
