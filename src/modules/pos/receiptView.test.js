import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildReceiptView, buildRefundReceiptView } from "./receiptView.js"

// Order #1 as saved: 2 x Pepsi (5% product discount) + 1 x Lux Soap, paid Rs 1000 cash.
// Product GST 18%, category tax (Beverages 5%, Soap 10%), store sales tax 18%, cash payment GST 16%.
const order = {
  order_number: 1,
  order_status: "completed",
  channel: "pos",
  is_custom: false,
  customer_id: null,
  register_session_id: "batch-uuid",
  payment_method: "cash",
  payment_status: "paid",
  placed_at: "2026-10-26T19:09:06.000Z",
  gross_amount: "300.00",
  line_discount_amount: "10.00",
  subtotal: "290.00",
  discount_amount: "0.00",
  coupon_code: null,
  coupon_discount_amount: "0.00",
  product_tax_amount: "52.20",
  category_tax_amount: "19.50",
  sales_tax_rate: "18.00",
  sales_tax_amount: "52.20",
  payment_gst_amount: "66.22",
  fbr_invoice_enabled: false,
  fbr_tax_amount: "0.00",
  shipping_fee: "0.00",
  amount_paid: "1000.00",
  change_due: "519.88",
  tax_breakdown: {
    sales_tax_rate: 18,
    payment_gst: [
      { method: "cash", bill_share: 413.9, gst_percent: 16, gst_amount: 66.22, amount: 480.12, paid: 1000, change: 519.88 },
    ],
  },
  OrderItems: [
    {
      item_number: 2,
      product_id: "soap-uuid",
      title: "Lux Soap",
      sku: "LUX-SOAP",
      unit: "piece",
      quantity: "1.0000",
      unit_price: "100.00",
      discount_amount: "0.00",
      subtotal: "100.00",
      tax_amount: "46.00",
      product_taxes: [{ name: "GST", type: "percentage", value: 18, amount: 18 }],
      category_tax_type: "percentage",
      category_tax_value: "10.00",
      category_tax_amount: "10.00",
      sales_tax_amount: "18.00",
    },
    {
      item_number: 1,
      product_id: "pepsi-uuid",
      title: "1 Litre Pepsi",
      sku: "1-LITRE-PEPSI",
      unit: "bottle",
      quantity: "2.0000",
      unit_price: "100.00",
      discount_amount: "10.00",
      subtotal: "190.00",
      tax_amount: "77.90",
      // Saved as a JSON string by some MySQL drivers.
      product_taxes: JSON.stringify([{ name: "GST", type: "percentage", value: 18, amount: 34.2 }]),
      category_tax_type: "percentage",
      category_tax_value: "5.00",
      category_tax_amount: "9.50",
      sales_tax_amount: "34.20",
    },
  ],
}

const receipt = {
  receipt_number: 1,
  store_id: "store-uuid",
  location_id: "loc-uuid",
  cashier_id: "staff-uuid",
  payment_id: "pay-uuid",
  subtotal: "290.00",
  discount_amount: "0.00",
  tax_amount: "190.12",
  shipping_fee: "0.00",
  total_amount: "480.12",
  issued_at: "2026-10-26T19:09:06.000Z",
}

const paymentRows = [{ id: "pay-uuid", transaction_number: 1, method: "cash", amount: "480.12", tax_amount: "66.22", status: "success" }]

const products = {
  "pepsi-uuid": { id: 1, title: "1 Litre Pepsi", sku: "1-LITRE-PEPSI", unit: "bottle", category: { id: 1, name: "Beverages", tax_name: "GST" } },
  "soap-uuid": { id: 2, title: "Lux Soap", sku: "LUX-SOAP", unit: "piece", category: { id: 2, name: "Soap", tax_name: "GST" } },
}
const lookups = {
  staff: () => ({ id: 4, name: "Yasir Ali Khan", role: "cashier" }),
  location: () => ({ id: 2, name: "Gulistan e Johar Block 17" }),
  customer: () => null,
  batch: () => ({ id: 1, status: "open" }),
  product: (id) => products[id] || null,
  productCategory: (id) => products[id]?.category || null,
}

const store = { name: "Acadex", ntn: "1234567-8", strn: null, currency: "PKR" }

describe("receiptView", () => {
  const view = buildReceiptView({ receipt, order, paymentRows, lookups, store })

  it("prints the sale with its totals; sales tax shown because it was charged", () => {
    assert.equal(view.id, 1)
    assert.equal(view.order_id, 1)
    assert.equal(view.issued_at, order.placed_at)
    assert.deepEqual(view.store, { name: "Acadex", ntn: "1234567-8", strn: null })
    assert.deepEqual(view.cashier, { id: 4, name: "Yasir Ali Khan" })
    assert.equal(view.subtotal, 290)
    assert.deepEqual(view.sales_tax, { rate: 18, amount: 52.2 })
    assert.equal(view.payment_gst_amount, 66.22)
    assert.equal(view.tax_amount, 190.12)
    assert.equal(view.total, 480.12)
    assert.equal(view.amount_paid, 1000)
    assert.equal(view.change_due, 519.88)
    assert.equal("order_discount" in view, false)
    assert.equal("fbr_fee" in view, false)
    assert.equal("remaining_amount" in view, false)
  })

  it("each line carries its product taxes, category tax and sales tax", () => {
    assert.deepEqual(view.items.map((item) => item.product.title), ["1 Litre Pepsi", "Lux Soap"])
    const pepsi = view.items[0]
    assert.equal(pepsi.product.id, 1)
    assert.deepEqual(pepsi.product.taxes, [{ name: "GST", type: "percentage", value: 18, amount: 34.2 }])
    assert.deepEqual(pepsi.category.tax, { name: null, type: "percentage", value: 5, amount: 9.5 })
    assert.deepEqual(pepsi.sales_tax, { rate: 18, amount: 34.2 })
    assert.equal(pepsi.offer, null)
    assert.equal(pepsi.discount_amount, 10)
    assert.equal(pepsi.total, 267.9)
    assert.equal(view.items[1].total, 146)
  })

  it("shows each payment with its GST %, amount, handed over and change", () => {
    assert.deepEqual(view.payments, [
      { method: "cash", gst_percent: 16, gst_amount: 66.22, amount: 480.12, paid: 1000, change: 519.88, status: "success" },
    ])
  })

  it("adds the order discount, FBR fee and remaining udhaar only when the sale had them", () => {
    const other = buildReceiptView({
      receipt,
      order: { ...order, fbr_invoice_enabled: true, fbr_tax_amount: "1.00", order_discount_type: "percentage", discount_amount: "29.00", total_amount: "480.12" },
      paymentRows: [{ ...paymentRows[0], amount: "100.00" }],
      lookups,
      store,
    })
    assert.deepEqual(other.order_discount, { type: "percentage", value: 10, amount: 29 })
    assert.equal(other.fbr_fee, 1)
    assert.equal(other.remaining_amount, 380.12)
  })
})

describe("refund receipt", () => {
  const refund = {
    refund_number: 2,
    refund_type: "partial",
    reason: "Customer return",
    cashier_id: "staff-uuid",
    amount: "136.07",
    tax_amount: "36.07",
    payments: [
      { method: "card", bill_share: 7.35, payment_tax_percent: 5, payment_tax_amount: 0.37, amount: 7.72 },
      { method: "cash", bill_share: 110.65, payment_tax_percent: 16, payment_tax_amount: 17.7, amount: 128.35 },
    ],
    OrderRefundItems: [
      { item_number: 1, order_item_id: "line-uuid", title: "Lux Soap", quantity: "1", unit_price: "100", subtotal: "100", tax_amount: "36.07" },
    ],
  }
  const view = buildRefundReceiptView({
    receipt: { receipt_number: 6, location_id: "loc-uuid", issued_at: "2026-10-27T18:24:51.000Z" },
    refund,
    orderNumber: 3,
    soldItems: [{ id: "line-uuid", item_number: 1, sku: "LUX-SOAP" }],
    lookups,
    store,
  })

  it("shows what came back and where the money went", () => {
    assert.equal(view.refund_id, 2)
    assert.equal(view.order_id, 3)
    assert.deepEqual(view.items, [{ id: 1, title: "Lux Soap", sku: "LUX-SOAP", qty: 1, unit_price: 100, total: 136.07 }])
    assert.equal(view.subtotal, 100)
    assert.equal(view.tax_amount, 36.07)
    assert.equal(view.total, 136.07)
    assert.deepEqual(view.payments, [{ method: "card", amount: 7.72 }, { method: "cash", amount: 128.35 }])
  })

  it("an older refund without a breakdown was paid back in cash", () => {
    const old = buildRefundReceiptView({ receipt: { receipt_number: 1 }, refund: { ...refund, payments: null }, lookups, store })
    assert.deepEqual(old.payments, [{ method: "cash", amount: 136.07 }])
  })
})
