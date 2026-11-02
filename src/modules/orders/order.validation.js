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

/** unit (default) or pack: how a line is sold; with pack, qty is the number of packs. */
function saleUnitOf(row, label) {
  const value = row.sale_unit ?? row.saleUnit
  if (value === undefined || value === null || value === "") return "unit"
  if (value !== "unit" && value !== "pack") throw new AppError(`${label}.sale_unit must be unit or pack`, 400)
  return value
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
    // A product with variants: the variant's number inside it (1, 2, 3…) or its UUID.
    variant_id: optionalRef(row, ["variant_id", "variantId"]),
    sale_unit: saleUnitOf(row, "item"),
    title: optionalString(row, "title"),
    custom_category: optionalString(row, "category") || optionalString(row, "custom_category"),
    quantity,
    weight: row.weight == null ? null : Number(row.weight),
    unit_price: price == null ? undefined : Number(price),
    discount_amount: row.discount_amount == null ? undefined : Number(row.discount_amount),
    sku: optionalString(row, "sku"),
    unit: optionalString(row, "unit"),
    cost_price: row.cost_price == null ? undefined : Number(row.cost_price),
    // No offer on this line (the product / category discount still applies).
    offer_exempt: Boolean(row.offer_exempt),
  }
}

// ---- POS-priced order: the till sends every figure; the server saves them as they are ----

const DISCOUNT_SOURCES = ["none", "product", "category", "product+category", "bulk_tier", "offer", "custom"]
// store = a tax from the Taxes page (kept with the product's own taxes on the line).
const TAX_LEVELS = ["product", "store", "category", "sales"]

function moneyAtLeastZero(row, key, label) {
  if (row[key] === undefined || row[key] === null || row[key] === "") return null
  const value = Number(row[key])
  if (Number.isNaN(value) || value < 0) throw new AppError(`${label}.${key} must be a number >= 0`, 400)
  return value
}

/** A line the till priced: { product_id | title, qty, unit_price, cost_price?, discount?, taxes[] }. */
function parsePricedLine(row, index) {
  const label = `lines[${index}]`
  if (!row || typeof row !== "object") throw new AppError(`${label} is invalid`, 400)
  const quantity = Number(row.qty ?? row.quantity ?? row.weight)
  if (Number.isNaN(quantity) || quantity <= 0) throw new AppError(`${label}.qty must be > 0`, 400)
  const product_id = optionalRef(row, ["product_id", "productId"])
  const title = optionalString(row, "title")
  if (!product_id && !title) throw new AppError(`${label} needs product_id, or title for a custom line`, 400)
  const unit_price = moneyAtLeastZero(row, "unit_price", label) ?? moneyAtLeastZero(row, "price", label)
  if (unit_price == null) throw new AppError(`${label}.unit_price is required`, 400)

  let discount = null
  if (row.discount && typeof row.discount === "object") {
    const source = row.discount.source == null ? "custom" : String(row.discount.source)
    if (!DISCOUNT_SOURCES.includes(source)) {
      throw new AppError(`${label}.discount.source must be one of ${DISCOUNT_SOURCES.join(", ")}`, 400)
    }
    discount = {
      source,
      offer_ref: optionalRef(row.discount, ["offer_id", "offerId"]),
      amount: moneyAtLeastZero(row.discount, "amount", `${label}.discount`) ?? 0,
      free_qty: moneyAtLeastZero(row.discount, "free_qty", `${label}.discount`) ?? 0,
    }
  }

  const taxes = (Array.isArray(row.taxes) ? row.taxes : []).map((tax, t) => {
    const taxLabel = `${label}.taxes[${t}]`
    if (!tax || typeof tax !== "object") throw new AppError(`${taxLabel} is invalid`, 400)
    const level = String(tax.level || "product")
    if (!TAX_LEVELS.includes(level)) throw new AppError(`${taxLabel}.level must be product, store, category or sales`, 400)
    const amount = moneyAtLeastZero(tax, "amount", taxLabel)
    if (amount == null) throw new AppError(`${taxLabel}.amount is required`, 400)
    return {
      level,
      name: tax.name == null ? null : String(tax.name).trim(),
      type: tax.type === "fixed" ? "fixed" : "percentage",
      rate: moneyAtLeastZero(tax, "rate", taxLabel) ?? moneyAtLeastZero(tax, "value", taxLabel),
      amount,
    }
  })

  return {
    product_id,
    // A product with variants: the variant's number inside it (1, 2, 3…) or its UUID.
    variant_id: optionalRef(row, ["variant_id", "variantId"]),
    // pack: qty = packs, unit_price / cost_price = one pack's.
    sale_unit: saleUnitOf(row, label),
    title,
    custom_category: optionalString(row, "category") || optionalString(row, "custom_category"),
    quantity,
    weight: row.weight == null ? null : Number(row.weight),
    unit_price,
    cost_price: moneyAtLeastZero(row, "cost_price", label),
    priced: { discount, taxes },
  }
}

/** { type?, value?, amount } for order_discount, { code, amount } for coupon; null / missing = none. */
function pricedAmount(body, key, extra) {
  const value = body[key]
  if (value == null || value === "") return null
  if (typeof value !== "object") throw new AppError(`${key} must be an object`, 400)
  const amount = moneyAtLeastZero(value, "amount", key) ?? 0
  return { ...extra(value), amount }
}

function parsePayment(row) {
  if (!row || typeof row !== "object") throw new AppError("Invalid payment", 400)
  const method = String(row.method || "")
  if (!PAYMENT_METHOD.includes(method) || method === "mixed") {
    throw new AppError("Invalid payment method", 400)
  }
  // amount: what this method pays toward the bill (its share + its payment tax);
  // bill_share: its share of the bill before payment tax; paid: what the customer handed over.
  const amount = optionalMoney(row, "amount")
  const bill_share = optionalMoney(row, "bill_share")
  const paid = optionalMoney(row, "paid")
  if (amount == null && bill_share == null && paid == null) {
    throw new AppError("payment amount must be > 0", 400)
  }
  // The card / wallet reference of this payment, if the till has one.
  const raw = row.transaction_id ?? row.transactionId
  const transaction_id = raw == null || raw === "" ? null : String(raw).trim().slice(0, 255)
  // POS-priced order: this method's payment tax as the till worked it out.
  const tax_rate = moneyAtLeastZero(row, "tax_rate", "payment")
  const tax_amount = moneyAtLeastZero(row, "tax_amount", "payment")
  // The payment method surcharge the till added: { surcharge_type, surcharge_value, surcharge_amount }.
  const surcharge_type = row.surcharge_type == null || row.surcharge_type === "" ? null : String(row.surcharge_type)
  if (surcharge_type && !["percentage", "fixed"].includes(surcharge_type)) {
    throw new AppError("payment surcharge_type must be percentage or fixed", 400)
  }
  const surcharge_value = moneyAtLeastZero(row, "surcharge_value", "payment")
  const surcharge_amount = moneyAtLeastZero(row, "surcharge_amount", "payment")
  return { method, amount, bill_share, paid, transaction_id, tax_rate, tax_amount, surcharge_type, surcharge_value, surcharge_amount }
}

function optionalMoney(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  const value = Number(body[key])
  if (Number.isNaN(value) || value <= 0) throw new AppError(`payment ${key} must be > 0`, 400)
  return value
}

// amount_paid per method ([{ method, paid }]) becomes each payment's paid.
function withPaid(payments, amountPaid) {
  if (!Array.isArray(amountPaid)) return payments
  const rows = payments.map((row) => (row && typeof row === "object" ? { ...row } : row))
  for (const entry of amountPaid) {
    const target = rows.find((row) => row?.method === entry?.method && row.paid == null)
    if (!target) throw new AppError("amount_paid method must match a payment", 400)
    target.paid = entry.paid ?? entry.amount
  }
  return rows
}

export function parseCreateOrder(body) {
  const channel = String(body.channel || "pos")
  if (!ORDER_CHANNEL.includes(channel)) {
    throw new AppError("channel must be web or pos", 400)
  }
  // lines[] = the till priced the order (every figure is saved as sent); items[] = the server prices it.
  const precomputed = Array.isArray(body.lines)
  const items = precomputed
    ? body.lines.map(parsePricedLine)
    : Array.isArray(body.items)
      ? body.items.map(parseItem)
      : []
  if (!items.length && channel !== "web") {
    throw new AppError("items are required", 400)
  }

  const payments = Array.isArray(body.payments)
    ? withPaid(body.payments, body.amount_paid).map(parsePayment)
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
    // No offer on any line of this order (product / category discounts still apply).
    offer_exempt: Boolean(body.offer_exempt),
    amount_paid: Array.isArray(body.amount_paid) || body.amount_paid == null || body.amount_paid === "" ? undefined : Number(body.amount_paid),
    approval_request_id: optionalUuid(body, "approval_request_id"),
    // Offline POS: when the sale was rung up on the device (ISO date-time).
    placed_at: optionalString(body, "placed_at"),
    offline: Boolean(body.offline),
    ...(precomputed
      ? {
          precomputed: true,
          is_custom: Boolean(body.is_custom) || items.every((line) => !line.product_id),
          order_discount: pricedAmount(body, "order_discount", (value) => ({
            type: value.type == null ? null : String(value.type),
            value: value.value == null ? null : Number(value.value),
          })),
          coupon: pricedAmount(body, "coupon", (value) => ({ code: value.code == null ? null : String(value.code).trim() })),
          shipping_fee: moneyAtLeastZero(body, "shipping_fee", "order") ?? 0,
          total_amount: moneyAtLeastZero(body, "total_amount", "order"),
        }
      : {}),
  }
}

export function parseVoidCancel(body) {
  return {
    reason: optionalString(body, "reason"),
    approval_request_id: optionalUuid(body, "approval_request_id"),
  }
}

export function parseAddPayment(body) {
  const payment = parsePayment(body)
  if (payment.amount == null) throw new AppError("payment amount must be > 0", 400)
  return payment
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
