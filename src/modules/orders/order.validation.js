import { AppError } from "../../shared/errors/AppError.js"
import { ORDER_CHANNEL, PAYMENT_METHOD } from "../../db/enums.js"
import { staffRefFrom } from "../../shared/utils/staff.util.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function optionalUuid(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  const value = String(body[key])
  if (!UUID_RE.test(value)) throw new AppError(`${key} must be a UUID`, 400)
  return value
}

function optionalString(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  return String(body[key]).trim()
}

/** A product / batch / customer reference: its short number (e.g. 1) or its UUID. */
function optionalRef(body, keys) {
  for (const key of keys) {
    const value = body[key]
    if (value === undefined || value === null || value === "") continue
    const ref = String(value).trim()
    if ((/^\d+$/.test(ref) && Number(ref) > 0) || UUID_RE.test(ref)) return ref
    throw new AppError(`${key} must be a number or a UUID`, 400)
  }
  return null
}

// Catalog line: { productId, qty }. Custom sale line: { category, title, price, qty }.
// The longer names (product_id, quantity, unit_price) still work.
function parseItem(row) {
  if (!row || typeof row !== "object") throw new AppError("Invalid item", 400)
  const quantity = Number(row.quantity ?? row.qty ?? row.weight)
  if (Number.isNaN(quantity) || quantity <= 0) {
    throw new AppError("Each item needs qty > 0", 400)
  }
  const price = row.unit_price ?? row.price
  return {
    product_id: optionalRef(row, ["product_id", "productId"]),
    title: optionalString(row, "title"),
    custom_category: optionalString(row, "category") || optionalString(row, "custom_category"),
    quantity,
    weight: row.weight == null ? null : Number(row.weight),
    unit_price: price == null ? undefined : Number(price),
    discount_amount: row.discount_amount == null ? undefined : Number(row.discount_amount),
    sku: optionalString(row, "sku"),
    unit: optionalString(row, "unit"),
    cost_price: row.cost_price == null ? undefined : Number(row.cost_price),
  }
}

function parsePayment(row) {
  if (!row || typeof row !== "object") throw new AppError("Invalid payment", 400)
  const method = String(row.method || "")
  if (!PAYMENT_METHOD.includes(method) || method === "mixed") {
    throw new AppError("Invalid payment method", 400)
  }
  const amount = Number(row.amount)
  if (Number.isNaN(amount) || amount <= 0) {
    throw new AppError("payment amount must be > 0", 400)
  }
  // The card / wallet reference of this payment, if the till has one.
  const raw = row.transaction_id ?? row.transactionId
  const transaction_id = raw == null || raw === "" ? null : String(raw).trim().slice(0, 255)
  return { method, amount, transaction_id }
}

export function parseCreateOrder(body) {
  const channel = String(body.channel || "")
  if (!ORDER_CHANNEL.includes(channel)) {
    throw new AppError("channel must be web or pos", 400)
  }
  const items = Array.isArray(body.items) ? body.items.map(parseItem) : []
  if (!items.length && channel !== "web") {
    throw new AppError("items are required", 400)
  }

  const payments = Array.isArray(body.payments)
    ? body.payments.map(parsePayment)
    : undefined

  let payment_method = body.payment_method ? String(body.payment_method) : null
  if (payments?.length > 1) payment_method = "mixed"
  else if (payments?.length === 1) payment_method = payments[0].method
  if (payment_method && !PAYMENT_METHOD.includes(payment_method)) {
    throw new AppError("Invalid payment_method", 400)
  }

  return {
    channel,
    items,
    payments,
    payment_method,
    is_custom: Boolean(body.is_custom),
    location_id: optionalUuid(body, "location_id"),
    customer_id: optionalRef(body, ["customer_id", "customerId"]),
    // The cashier who made the sale (picked by PIN); defaults to the signed-in user.
    staff_ref: staffRefFrom(body),
    address_id: optionalUuid(body, "address_id"),
    from_cart: body.from_cart === undefined ? channel === "web" : Boolean(body.from_cart),
    // The open batch (cash drawer): its number (batchId) or UUID.
    register_session_id: optionalRef(body, ["batch_id", "batchId", "register_session_id"]),
    device_id: optionalUuid(body, "device_id"),
    client_local_id: optionalString(body, "client_local_id"),
    coupon_code: optionalString(body, "coupon_code"),
    shipping_address: optionalString(body, "shipping_address"),
    order_discount_type: optionalString(body, "order_discount_type"),
    order_discount_value:
      body.order_discount_value == null ? undefined : Number(body.order_discount_value),
    tax_exempt: Boolean(body.tax_exempt),
    amount_paid: body.amount_paid == null ? undefined : Number(body.amount_paid),
    total_amount: body.total_amount == null ? undefined : Number(body.total_amount),
    approval_request_id: optionalUuid(body, "approval_request_id"),
    // Offline POS: when the sale was rung up on the device (ISO date-time).
    placed_at: optionalString(body, "placed_at"),
    offline: Boolean(body.offline),
  }
}

export function parseVoidCancel(body) {
  return {
    reason: optionalString(body, "reason"),
    approval_request_id: optionalUuid(body, "approval_request_id"),
  }
}

export function parseAddPayment(body) {
  return parsePayment(body)
}

// order_item_id: the line's UUID, or its item number inside the order (1, 2, 3...).
export function parseRefundItem(body) {
  const order_item_id = optionalRef(body, ["order_item_id", "orderItemId"])
  if (!order_item_id) throw new AppError("order_item_id is required", 400)
  const quantity = Number(body.quantity ?? body.qty)
  if (Number.isNaN(quantity) || quantity <= 0) {
    throw new AppError("qty must be > 0", 400)
  }
  const reason = optionalString(body, "reason")
  if (!reason) throw new AppError("reason is required", 400)
  return { order_item_id, quantity, reason, staff_ref: staffRefFrom(body) }
}

export function parseRefundComplete(body) {
  const reason = optionalString(body, "reason")
  if (!reason) throw new AppError("reason is required", 400)
  return { reason, staff_ref: staffRefFrom(body) }
}

// order_id: the order number (e.g. 1) or its UUID.
export function parseBulkRefundItem(body) {
  const order_id = optionalRef(body, ["order_id", "orderId"])
  if (!order_id) throw new AppError("order_id is required", 400)
  return { order_id, ...parseRefundItem(body) }
}

export function parseBulkRefundComplete(body) {
  const order_id = optionalRef(body, ["order_id", "orderId"])
  if (!order_id) throw new AppError("order_id is required", 400)
  return { order_id, ...parseRefundComplete(body) }
}
