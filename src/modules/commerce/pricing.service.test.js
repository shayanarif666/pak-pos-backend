import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  applyDiscount,
  bogoFreeQty,
  lineTaxAmount,
  lineTaxBreakdown,
  money,
  priceAfterProductDiscount,
  priceCatalogLine,
  quoteOrderTotals,
  quoteShipping,
  splitPaymentTax,
  splitRefund,
} from "./pricing.service.js"

describe("pricing.service", () => {
  it("rounds money to 2 decimals", () => {
    assert.equal(money(10.126), 10.13)
    assert.equal(money(10.124), 10.12)
  })

  it("applies percentage and fixed discounts", () => {
    assert.equal(applyDiscount(200, "percentage", 10), 20)
    assert.equal(applyDiscount(200, "fixed", 50), 50)
    assert.equal(applyDiscount(20, "fixed", 50), 20)
  })

  it("applies product discount before offers", () => {
    const product = {
      id: "p1",
      selling_price: 100,
      has_product_discount: true,
      discount_type: "percentage",
      discount_value: 10,
    }
    assert.equal(priceAfterProductDiscount(product), 90)
  })

  it("applies category discount when product has none", () => {
    const product = {
      id: "p1",
      selling_price: 100,
      has_product_discount: false,
      category: { discount_type: "percentage", discount_value: 20 },
    }
    assert.equal(priceAfterProductDiscount(product), 80)
  })

  it("computes BOGO free qty in groups", () => {
    assert.equal(bogoFreeQty(3, 2, 1), 1)
    assert.equal(bogoFreeQty(5, 2, 1), 1)
    assert.equal(bogoFreeQty(6, 2, 1), 2)
  })

  it("does not stack a weaker offer on top of product discount", () => {
    const product = {
      id: "p1",
      category_id: "c1",
      title: "Pepsi",
      sku: "PEP",
      selling_price: 90,
      cost_price: 60,
      has_product_discount: true,
      discount_type: "percentage",
      discount_value: 17,
      unit: "piece",
    }
    const line = priceCatalogLine({
      product,
      quantity: 2,
      offers: [
        {
          id: "o1",
          type: "promotional",
          is_active: true,
          discount_type: "percentage",
          discount_value: 10,
          OfferTargets: [{ product_id: "p1" }],
        },
      ],
    })
    assert.equal(line.pricing_source, "product")
    assert.equal(line.discount_amount, 30.6)
    assert.equal(line.subtotal, 149.4)
  })

  it("applies product, category and sales tax each on the line amount (no stacking)", () => {
    const store = { charge_tax_on_sales: true, sales_tax_rate: 17 }
    const product = { taxes: [{ name: "Import duty", type: "percentage", value: 5 }] }
    const category = { tax_type: "percentage", tax_value: 5 }
    const row = lineTaxBreakdown(store, product, category, 100)
    assert.equal(row.product_tax_amount, 5)
    assert.equal(row.category_tax_amount, 5)
    assert.equal(row.sales_tax_amount, 17)
    assert.equal(row.tax_amount, 27)
  })

  it("adds every tax in a product's list; a fixed tax is per unit", () => {
    const store = { charge_tax_on_sales: true }
    const product = {
      taxes: [
        { name: "GST", type: "percentage", value: 10 },
        { name: "Excise", type: "fixed", value: 2 },
      ],
    }
    const row = lineTaxBreakdown(store, product, null, 300, 3)
    assert.equal(row.product_tax_amount, 36) // 30 + 2 × 3
    assert.deepEqual(row.product_taxes.map((tax) => tax.amount), [30, 6])
  })

  it("quotes 100 + 10% product + 10% sales tax + 12% cash GST = 134.4", () => {
    const store = { charge_tax_on_sales: true, sales_tax_rate: 10 }
    const product = { taxes: [{ name: "GST", type: "percentage", value: 10 }] }
    const tax = lineTaxBreakdown(store, product, null, 100)
    const quoted = quoteOrderTotals({
      lines: [
        {
          unit_price: 100,
          quantity: 1,
          discount_amount: 0,
          subtotal: 100,
          tax_amount: tax.tax_amount,
          product_tax_amount: tax.product_tax_amount,
          category_tax_amount: 0,
          sales_tax_amount: tax.sales_tax_amount,
          cost_price: 50,
        },
      ],
      store,
      channel: "pos",
      paymentMethod: "cash",
      taxRates: [{ payment_method: "cash", gst_percent: 12 }],
    })
    assert.equal(quoted.subtotal, 100)
    assert.equal(quoted.product_tax_amount, 10)
    assert.equal(quoted.sales_tax_amount, 10)
    assert.equal(quoted.line_tax, 20)
    assert.equal(quoted.payment_gst_amount, 14.4)
    assert.equal(quoted.total_amount, 134.4)
  })

  it("skips sales tax while the store has it switched off", () => {
    const store = { charge_tax_on_sales: true, sales_tax_rate: 18, sales_tax_enabled: false }
    const product = { taxes: [{ name: "GST", type: "percentage", value: 17 }] }
    const row = lineTaxBreakdown(store, product, null, 100)
    assert.equal(row.sales_tax_amount, 0)
    assert.equal(row.tax_amount, 17)
  })

  it("skips payment GST while the store has it switched off", () => {
    const quoted = quoteOrderTotals({
      lines: [{ unit_price: 100, quantity: 1, discount_amount: 0, subtotal: 100, tax_amount: 0, cost_price: 50 }],
      store: { charge_tax_on_sales: true, payment_tax_enabled: false },
      channel: "pos",
      paymentMethod: "cash",
      taxRates: [{ payment_method: "cash", gst_percent: 16 }],
    })
    assert.equal(quoted.payment_gst_amount, 0)
    assert.equal(quoted.total_amount, 100)
  })

  it("adds payment GST on mixed POS tenders", () => {
    const quoted = quoteOrderTotals({
      lines: [
        {
          unit_price: 250,
          quantity: 1,
          discount_amount: 0,
          subtotal: 250,
          tax_amount: 12.5,
          product_tax_amount: 5,
          category_tax_amount: 7.5,
          sales_tax_amount: 0,
          cost_price: 125,
        },
      ],
      store: { charge_tax_on_sales: true, fbr_invoice_enabled: true },
      channel: "pos",
      paymentMethod: "mixed",
      paymentSplits: [
        { method: "cash", amount: 131.25 },
        { method: "card", amount: 131.25 },
      ],
      taxRates: [
        { payment_method: "cash", gst_percent: 16 },
        { payment_method: "card", gst_percent: 5 },
      ],
    })
    assert.equal(quoted.product_tax_amount, 5)
    assert.equal(quoted.category_tax_amount, 7.5)
    assert.equal(quoted.payment_gst_splits.length, 2)
    assert.equal(quoted.fbr_invoice_enabled, true)
    assert.ok(quoted.payment_gst_amount > 0)
    assert.equal(quoted.fbr_tax_amount, quoted.tax_amount)
  })

  it("adds 17% tax after 17% product discount", () => {
    const store = { charge_tax_on_sales: true }
    const product = { taxes: [{ name: "GST", type: "percentage", value: 17 }] }
    assert.equal(lineTaxAmount(store, product, null, 149.4), 25.4)
  })

  it("picks the better of product bulk vs offer, without stacking both", () => {
    const product = {
      id: "p1",
      category_id: "c1",
      title: "Rice",
      sku: "R",
      selling_price: 100,
      cost_price: 60,
      has_product_discount: false,
      has_bulk_discount: true,
      unit: "piece",
    }
    const line = priceCatalogLine({
      product,
      quantity: 10,
      bulkTiers: [{ min_qty: 10, discount_type: "percentage", discount_value: 5 }],
      offers: [
        {
          id: "o1",
          type: "bulk_discount",
          is_active: true,
          min_qty: 10,
          discount_type: "percentage",
          discount_value: 20,
          OfferTargets: [{ product_id: "p1" }],
        },
      ],
    })
    assert.equal(line.pricing_source, "offer_bulk")
    assert.equal(line.discount_amount, 200)
    assert.equal(line.subtotal, 800)
  })

  it("POS shipping is 0 and web uses the flat fee", () => {
    const rule = { flat_fee: 50, free_over_amount: 1000 }
    assert.equal(quoteShipping("pos", rule, 200), 0)
    assert.equal(quoteShipping("web", rule, 200), 50)
    assert.equal(quoteShipping("web", rule, 1000), 0)
  })

  it("quotes Pepsi 90 x2 with 17% discount then 17% tax", () => {
    const lines = [
      {
        unit_price: 90,
        quantity: 2,
        discount_amount: 30.6,
        subtotal: 149.4,
        tax_amount: 25.4,
        cost_price: 60,
      },
    ]
    const quoted = quoteOrderTotals({
      lines,
      store: { charge_tax_on_sales: true },
      channel: "pos",
      paymentMethod: "cash",
    })
    assert.equal(quoted.gross_amount, 180)
    assert.equal(quoted.line_discount_amount, 30.6)
    assert.equal(quoted.subtotal, 149.4)
    assert.equal(quoted.tax_amount, 25.4)
    assert.equal(quoted.total_amount, 174.8)
    assert.equal(quoted.cost_total, 120)
  })

  it("quotes the same goods total for web and POS except shipping", () => {
    const lines = [{ subtotal: 200, tax_amount: 0, cost_price: 50, quantity: 2 }]
    const store = { charge_tax_on_sales: false }
    const rule = { flat_fee: 40, free_over_amount: null }
    const pos = quoteOrderTotals({
      lines,
      store,
      channel: "pos",
      shippingRule: rule,
      paymentMethod: "cash",
    })
    const web = quoteOrderTotals({
      lines,
      store,
      channel: "web",
      shippingRule: rule,
      paymentMethod: "cash",
    })
    assert.equal(pos.subtotal, web.subtotal)
    assert.equal(pos.shipping_fee, 0)
    assert.equal(web.shipping_fee, 40)
    assert.equal(web.total_amount, money(pos.total_amount + 40))
  })
})

describe("splitPaymentTax", () => {
  const store = { charge_tax_on_sales: true, payment_tax_enabled: true }
  const taxRates = [
    { payment_method: "cash", gst_percent: 16 },
    { payment_method: "easypaisa", gst_percent: 5 },
  ]

  it("taxes each method on its own share; cash covers the rest and gives change", () => {
    const split = splitPaymentTax({
      store,
      taxRates,
      preGst: 606.55,
      payments: [
        { method: "easypaisa", amount: 111.88 },
        { method: "cash", paid: 1000 },
      ],
    })
    assert.deepEqual(
      split.splits.map(({ method, bill_share, gst_amount, amount, paid, change }) => ({ method, bill_share, gst_amount, amount, paid, change })),
      [
        { method: "easypaisa", bill_share: 106.55, gst_amount: 5.33, amount: 111.88, paid: 111.88, change: 0 },
        { method: "cash", bill_share: 500, gst_amount: 80, amount: 580, paid: 1000, change: 420 },
      ]
    )
    assert.equal(split.gst, 85.33)
  })

  it("no payment tax while payment_tax_enabled is off", () => {
    const split = splitPaymentTax({
      store: { ...store, payment_tax_enabled: false },
      taxRates,
      preGst: 606.55,
      payments: [{ method: "cash", paid: 700 }],
    })
    assert.equal(split.gst, 0)
    assert.equal(split.splits[0].change, 93.45)
  })

  it("refuses a card / wallet paying more than the bill", () => {
    assert.throws(() =>
      splitPaymentTax({ store, taxRates, preGst: 100, payments: [{ method: "easypaisa", amount: 500 }] })
    )
  })
})

describe("splitRefund", () => {
  const split = [
    { method: "card", amount: 600, gst_percent: 5 },
    { method: "cash", amount: 937.25, gst_percent: 16 },
  ]

  it("pays one unit of 12 back per method at each method's own payment tax", () => {
    const rows = splitRefund({ buckets: split, fraction: 1 / 12 })
    assert.deepEqual(rows, [
      { method: "card", bill_share: 47.62, payment_tax_percent: 5, payment_tax_amount: 2.38, amount: 50 },
      { method: "cash", bill_share: 67.33, payment_tax_percent: 16, payment_tax_amount: 10.77, amount: 78.1 },
    ])
  })

  it("returns exactly what each method paid once everything is refunded unit by unit", () => {
    const refunded = {}
    for (let unit = 1; unit <= 12; unit += 1) {
      for (const row of splitRefund({ buckets: split, refunded, fraction: unit / 12 })) {
        refunded[row.method] = Number(((refunded[row.method] || 0) + row.amount).toFixed(2))
      }
    }
    assert.deepEqual(refunded, { card: 600, cash: 937.25 })
  })

  it("closes a single cash payment out to the paisa", () => {
    const buckets = [{ method: "cash", amount: 1600.1, gst_percent: 16 }]
    const first = splitRefund({ buckets, fraction: 1 / 12 })
    assert.equal(first[0].amount, 133.34)
    const rest = splitRefund({ buckets, refunded: { cash: 133.34 * 11 }, fraction: 1 })
    assert.equal(rest[0].amount, 133.36)
  })
})
