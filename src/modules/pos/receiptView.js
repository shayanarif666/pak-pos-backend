/**
 * Receipt (invoice) shapes for the POS — pure builders with no DB access, so they can be unit
 * tested. posReceipt() / posRefundReceipt() in posResponses.js load the rows and the lookups.
 *
 * A receipt carries only what is printed on it, each figure once. Every figure comes from what
 * was saved when the sale (or refund) was made, never from the current catalog.
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

const person = (ref) => (ref ? { id: ref.id, name: ref.name } : null)

/** The store header: name, and NTN / STRN for a tax invoice. */
function storeView(store) {
  return { name: store?.name || null, ntn: store?.ntn || null, strn: store?.strn || null }
}

/** One sold line: qty × unit price, its discount, how much was refunded, and its total with tax. */
export function receiptItemView(item) {
  return {
    id: item.item_number,
    title: item.title,
    sku: item.sku || null,
    qty: num(item.quantity),
    unit_price: num(item.unit_price),
    discount_amount: money(item.discount_amount),
    refunded_qty: num(item.refunded_qty) ?? 0,
    total: money(Number(item.subtotal || 0) + Number(item.tax_amount || 0)),
  }
}

/** Each payment row: method, status and the amount it paid toward the bill. */
export function receiptPaymentsView(paymentRows) {
  return [...(paymentRows || [])]
    .sort((a, b) => Number(a.transaction_number || 0) - Number(b.transaction_number || 0))
    .map((row) => ({ method: row.method, status: row.status || null, amount: money(row.amount) }))
}

/** The sale receipt. tax_breakdown is filled only for an FBR (tax) invoice. */
export function buildReceiptView({ receipt, order, paymentRows, lookups, store }) {
  const items = [...(order?.OrderItems || [])]
    .sort((a, b) => a.item_number - b.item_number)
    .map((item) => receiptItemView(item))
  const fbr = Boolean(order?.fbr_invoice_enabled)

  return {
    id: receipt.receipt_number,
    order_id: order?.order_number ?? null,
    store: storeView(store),
    issued_at: receipt.issued_at,
    channel: order?.channel || null,
    status: order?.order_status || null,
    payment_status: order?.payment_status || null,
    payment_method: order?.payment_method || null,
    location: lookups.location(receipt.location_id),
    cashier: person(lookups.staff(receipt.cashier_id)),
    customer: order ? person(lookups.customer(order.customer_id)) : null,
    currency: store?.currency || "PKR",
    items,
    subtotal: num(order?.subtotal ?? receipt.subtotal),
    discount_amount: money(Number(order?.discount_amount || 0) + Number(order?.coupon_discount_amount || 0)),
    tax_amount: num(receipt.tax_amount),
    total: num(receipt.total_amount),
    amount_paid: num(order?.amount_paid) ?? 0,
    change_due: num(order?.change_due) ?? 0,
    payments: receiptPaymentsView(paymentRows),
    tax_breakdown: fbr
      ? {
          product_tax: money(order.product_tax_amount),
          category_tax: money(order.category_tax_amount),
          sales_tax: money(order.sales_tax_amount),
          payment_tax: money(order.payment_gst_amount),
        }
      : null,
  }
}

/**
 * A refund's receipt: what came back (items) and where the money went (payments: card / cash /
 * credit = off the udhaar). Older refunds without a breakdown were paid back in cash.
 */
export function buildRefundReceiptView({ receipt, refund, orderNumber, soldItems, lookups, store }) {
  const sold = new Map((soldItems || []).map((row) => [row.id, row]))
  const items = [...(refund.OrderRefundItems || [])]
    .sort((a, b) => a.item_number - b.item_number)
    .map((line) => {
      const item = sold.get(line.order_item_id)
      return {
        id: item?.item_number ?? null,
        title: line.title,
        sku: item?.sku || null,
        qty: num(line.quantity),
        unit_price: num(line.unit_price),
        total: money(Number(line.subtotal || 0) + Number(line.tax_amount || 0)),
      }
    })
  const total = money(refund.amount)
  const payments = parseJson(refund.payments, null)

  return {
    id: receipt.receipt_number,
    refund_id: refund.refund_number,
    order_id: orderNumber ?? null,
    refund_type: refund.refund_type || "partial",
    reason: refund.reason || null,
    store: storeView(store),
    issued_at: receipt.issued_at,
    location: lookups.location(receipt.location_id),
    cashier: person(lookups.staff(refund.cashier_id)),
    currency: store?.currency || "PKR",
    items,
    subtotal: money(total - Number(refund.tax_amount || 0)),
    tax_amount: money(refund.tax_amount),
    total,
    payments: Array.isArray(payments)
      ? payments.map((row) => ({ method: row.method, amount: money(row.amount) }))
      : [{ method: "cash", amount: total }],
  }
}
