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

const present = (value) => Number(value) > 0.0049

function discountView(snapshot) {
  const d = parseJson(snapshot, null)
  if (!d || !present(d.amount)) return null
  return { name: d.name || null, type: d.type || null, value: num(d.value), amount: money(d.amount) }
}

/** What remains owed on an udhaar sale: total − what the payments covered − udhaar refunded. */
export function remainingAmountOf(order, paymentRows, creditRefunded = 0) {
  const paid = (paymentRows || [])
    .filter((row) => !row.status || row.status === "success")
    .reduce((sum, row) => sum + Number(row.amount || 0), 0)
  return money(Math.max(0, Number(order?.total_amount || 0) - paid - Number(creditRefunded || 0)))
}

/**
 * One sold line as printed: the product (barcode), its own discount and taxes, its category's
 * discount and tax, the offer that priced it, the sales tax (only when charged), what was
 * refunded and the line total. Every figure is the sale-time snapshot kept on the line.
 */
export function receiptItemView(item, lookups = {}, { salesTaxRate = null } = {}) {
  const base = {
    id: item.item_number,
    qty: num(item.quantity),
    // Sold by the pack: packs × pack_price (qty stays in units).
    ...(item.sale_unit === "pack"
      ? { sale_unit: "pack", packs: num(item.qty_packs), pack_size: item.pack_size ?? null, pack_price: num(item.pack_price) }
      : { sale_unit: "unit" }),
    unit_price: num(item.unit_price),
    gross_amount: money(Number(item.unit_price || 0) * Number(item.quantity || 0)),
  }
  const salesTax = present(item.sales_tax_amount)
    ? { rate: num(salesTaxRate), amount: money(item.sales_tax_amount) }
    : null
  const totals = {
    discount_amount: money(item.discount_amount),
    subtotal: money(item.subtotal),
    tax_amount: money(item.tax_amount),
    refunded_qty: num(item.refunded_qty) ?? 0,
    total: money(Number(item.subtotal || 0) + Number(item.tax_amount || 0)),
  }
  if (!item.product_id) {
    return {
      ...base,
      title: item.title,
      category: item.custom_category ? { id: null, name: item.custom_category } : null,
      ...(salesTax ? { sales_tax: salesTax } : {}),
      ...totals,
    }
  }
  const productRef = lookups.product?.(item.product_id) || null
  const categoryRef = lookups.category?.(item.category_id || productRef?.category_id) || null
  const offers = parseJson(item.offers, []) || []
  const productTaxes = (parseJson(item.product_taxes, []) || [])
    .filter((tax) => present(tax?.amount))
    .map((tax) => ({ name: tax.name || "Tax", type: tax.type || null, value: num(tax.value), amount: money(tax.amount) }))
  const categoryTax = present(item.category_tax_amount)
    ? {
        name: item.category_tax_name || null,
        type: item.category_tax_type || null,
        value: num(item.category_tax_value),
        amount: money(item.category_tax_amount),
      }
    : null
  return {
    ...base,
    product: {
      id: productRef?.id ?? null,
      // A variant: { id (its number inside the product), name }; null otherwise.
      variant: productRef?.variant ?? null,
      title: item.title,
      sku: item.sku || productRef?.sku || null,
      barcode: item.barcode || null,
      discount: discountView(item.product_discount),
      taxes: productTaxes,
    },
    category: categoryRef || item.category_name || categoryTax || discountView(item.category_discount)
      ? {
          id: categoryRef?.id ?? null,
          name: item.category_name || categoryRef?.name || null,
          discount: discountView(item.category_discount),
          tax: categoryTax,
        }
      : null,
    offer: offers[0]
      ? {
          id: offers[0].id ?? null,
          name: offers[0].name || null,
          type: offers[0].type || null,
          discount_type: offers[0].discount_type || null,
          discount_value: num(offers[0].discount_value),
          amount: money(offers[0].amount),
        }
      : null,
    ...(present(item.free_qty) ? { free_qty: num(item.free_qty) } : {}),
    ...(salesTax ? { sales_tax: salesTax } : {}),
    ...totals,
  }
}

/** Each payment of the sale: method, its payment GST %, what it paid toward the bill, handed over, change. */
export function receiptPaymentsView(order, paymentRows) {
  const splits = (parseJson(order?.tax_breakdown, {})?.payment_gst || []).filter((row) => Number(row?.amount) > 0)
  const rows = [...(paymentRows || [])].sort(
    (a, b) => Number(a.transaction_number || 0) - Number(b.transaction_number || 0)
  )
  if (!splits.length) {
    return rows.map((row) => ({
      method: row.method,
      gst_percent: null,
      gst_amount: money(row.tax_amount),
      amount: money(row.amount),
      paid: money(row.amount),
      change: 0,
      status: row.status || null,
    }))
  }
  return splits.map((split) => {
    const row = rows.find((r) => r.method === split.method)
    return {
      method: split.method,
      gst_percent: num(split.gst_percent),
      gst_amount: money(split.gst_amount),
      amount: money(split.amount),
      paid: money(split.paid ?? split.amount),
      change: money(split.change),
      status: row?.status || null,
    }
  })
}

/** The order discount as entered: its % (worked back from the amount) or the fixed amount. */
function orderDiscountValue(order, amount) {
  if (order.order_discount_type === "percentage" && Number(order.subtotal) > 0) {
    return money((amount / Number(order.subtotal)) * 100)
  }
  return amount
}

/**
 * The sale receipt. Lines carry their product / category / offer detail; order_discount,
 * coupon, sales_tax and fbr_fee appear only when the sale had them; remaining_amount only on an
 * udhaar (partial) sale. issued_at = when the sale happened (placed_at), even if it synced later.
 */
export function buildReceiptView({ receipt, order, paymentRows, lookups, store, creditRefunded = 0 }) {
  const breakdown = parseJson(order?.tax_breakdown, {}) || {}
  const salesTaxRate = order?.sales_tax_rate ?? breakdown.sales_tax_rate ?? null
  const items = [...(order?.OrderItems || [])]
    .sort((a, b) => a.item_number - b.item_number)
    .map((item) => receiptItemView(item, lookups, { salesTaxRate }))
  const remaining = remainingAmountOf(order, paymentRows, creditRefunded)
  const orderDiscount = money(order?.discount_amount)
  const coupon = money(order?.coupon_discount_amount)

  return {
    id: receipt?.receipt_number ?? null,
    order_id: order?.order_number ?? null,
    store: storeView(store),
    issued_at: order?.placed_at || receipt?.issued_at || null,
    channel: order?.channel || null,
    status: order?.order_status || null,
    payment_status: order?.payment_status || null,
    payment_method: order?.payment_method || null,
    location: lookups.location(order?.location_id || receipt?.location_id),
    cashier: person(lookups.staff(order?.cashier_id || receipt?.cashier_id)),
    customer: order ? person(lookups.customer(order.customer_id)) : null,
    currency: store?.currency || "PKR",
    items,
    subtotal: num(order?.subtotal),
    ...(present(orderDiscount)
      ? { order_discount: { type: order.order_discount_type || null, value: orderDiscountValue(order, orderDiscount), amount: orderDiscount } }
      : {}),
    ...(present(coupon) ? { coupon: { code: order.coupon_code || null, amount: coupon } } : {}),
    ...(present(order?.sales_tax_amount) ? { sales_tax: { rate: num(salesTaxRate), amount: money(order.sales_tax_amount) } } : {}),
    payment_gst_amount: money(order?.payment_gst_amount),
    tax_amount: num(order?.tax_amount ?? receipt?.tax_amount),
    ...(order?.fbr_invoice_enabled ? { fbr_fee: money(order.fbr_tax_amount) } : {}),
    total: num(order?.total_amount ?? receipt?.total_amount),
    amount_paid: num(order?.amount_paid) ?? 0,
    change_due: num(order?.change_due) ?? 0,
    ...(present(remaining) ? { remaining_amount: remaining } : {}),
    payments: receiptPaymentsView(order, paymentRows),
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
