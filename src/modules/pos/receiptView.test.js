import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildReceiptView, lineTaxes, receiptPaymentsView } from "./receiptView.js"

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

describe("receiptView", () => {
  const view = buildReceiptView({ receipt, order, paymentRows, lookups, currency: "PKR" })

  it("keeps the fields the POS already reads", () => {
    assert.equal(view.id, 1)
    assert.deepEqual(view.order.id, 1)
    assert.equal(view.order.status, "completed")
    assert.deepEqual(view.transaction, { id: 1, method: "cash" })
    assert.equal(view.subTotal, 290)
    assert.equal(view.tax_breakdown.payment_gst, "16%")
    assert.equal(view.tax_amount, 190.12)
    assert.equal(view.total, 480.12)
    assert.equal(view.currency, "PKR")
  })

  it("lists the items in line order with every tax by source", () => {
    assert.deepEqual(view.items.map((item) => item.title), ["1 Litre Pepsi", "Lux Soap"])
    const pepsi = view.items[0]
    assert.equal(pepsi.product_id, 1)
    assert.equal(pepsi.category, "Beverages")
    assert.equal(pepsi.qty, 2)
    assert.equal(pepsi.gross_amount, 200)
    assert.equal(pepsi.discount_amount, 10)
    assert.equal(pepsi.taxable_amount, 190)
    assert.deepEqual(
      pepsi.taxes.map((tax) => [tax.source, tax.value, tax.amount]),
      [["product", 18, 34.2], ["category", 5, 9.5], ["sales_tax", 18, 34.2]]
    )
    assert.equal(pepsi.tax_amount, 77.9)
    assert.equal(pepsi.total, 267.9)
    assert.equal(view.items[1].total, 146)
  })

  it("shows each payment with its payment GST and transaction number", () => {
    assert.deepEqual(view.payments, [
      {
        transaction_id: 1,
        method: "cash",
        bill_share: 413.9,
        payment_tax_percent: 16,
        payment_tax_amount: 66.22,
        amount: 480.12,
        paid: 1000,
        change: 519.88,
        status: "success",
      },
    ])
  })

  it("summary adds up: discounts, each tax and the total", () => {
    const s = view.summary
    assert.equal(s.gross_amount, 300)
    assert.equal(s.items_discount, 10)
    assert.equal(s.total_discount, 10)
    assert.equal(s.subTotal, 290)
    assert.equal(s.product_tax, 52.2)
    assert.equal(s.category_tax, 19.5)
    assert.equal(s.sales_tax, 52.2)
    assert.equal(s.items_tax, 123.9)
    assert.equal(s.payment_gst, 66.22)
    assert.equal(Number((s.items_tax + s.payment_gst).toFixed(2)), s.tax_amount)
    assert.equal(Number((s.subTotal + s.tax_amount).toFixed(2)), s.total)
    assert.equal(s.change_due, 519.88)
  })

  it("custom lines carry the category typed at the till", () => {
    const [line] = buildReceiptView({
      receipt,
      order: {
        ...order,
        OrderItems: [{ item_number: 1, product_id: null, title: "Tissue Box", custom_category: "Household", quantity: "1", unit_price: "150", discount_amount: "0", subtotal: "150", tax_amount: "27", sales_tax_amount: "27" }],
      },
      paymentRows,
      lookups,
    }).items
    assert.equal(line.item_type, "custom")
    assert.equal(line.category, "Household")
    assert.deepEqual(line.taxes, [{ source: "sales_tax", name: "Sales Tax", type: "percentage", value: 18, amount: 27 }])
  })

  it("mixed payments match their payment rows by position", () => {
    const mixed = receiptPaymentsView(
      {
        tax_breakdown: {
          payment_gst: [
            { method: "jazzcash", bill_share: 47.62, gst_percent: 5, gst_amount: 2.38, amount: 50, paid: 50, change: 0 },
            { method: "cash", bill_share: 318.18, gst_percent: 16, gst_amount: 50.91, amount: 369.09, paid: 500, change: 130.91 },
          ],
        },
      },
      [
        { transaction_number: 8, method: "cash", status: "success" },
        { transaction_number: 7, method: "jazzcash", status: "success" },
      ]
    )
    assert.deepEqual(mixed.map((row) => [row.method, row.transaction_id]), [["jazzcash", 7], ["cash", 8]])
  })

  it("skips taxes that were not charged", () => {
    assert.deepEqual(lineTaxes({ product_taxes: [{ name: "GST", amount: 0 }], category_tax_amount: 0, sales_tax_amount: 0 }), [])
  })
})
