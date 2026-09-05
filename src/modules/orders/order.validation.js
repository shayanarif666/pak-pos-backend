import { AppError } from "../../shared/errors/AppError.js"
import { ORDER_CHANNEL, PAYMENT_METHOD } from "../../db/enums.js"

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

function parseItem(row) {
  if (!row || typeof row !== "object") throw new AppError("Invalid item", 400)
  const quantity = Number(row.quantity ?? row.weight)
  if (Number.isNaN(quantity) || quantity <= 0) {
    throw new AppError("Each item needs quantity > 0", 400)
  }
  return {
    product_id: optionalUuid(row, "product_id"),
    title: optionalString(row, "title"),
    quantity,
    weight: row.weight == null ? null : Number(row.weight),
    unit_price: row.unit_price == null ? undefined : Number(row.unit_price),
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
  return { method, amount }
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
    customer_id: optionalUuid(body, "customer_id"),
    address_id: optionalUuid(body, "address_id"),
    from_cart: body.from_cart === undefined ? channel === "web" : Boolean(body.from_cart),
    register_session_id: optionalUuid(body, "register_session_id"),
    device_id: optionalUuid(body, "device_id"),
    client_local_id: optionalString(body, "client_local_id"),
    coupon_code: optionalString(body, "coupon_code"),
    shipping_address: optionalString(body, "shipping_address"),
    order_discount_type: optionalString(body, "order_discount_type"),
    order_discount_value:
      body.order_discount_value == null ? undefined : Number(body.order_discount_value),
    amount_paid: body.amount_paid == null ? undefined : Number(body.amount_paid),
    total_amount: body.total_amount == null ? undefined : Number(body.total_amount),
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
