import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  applyDiscount,
  bogoFreeQty,
  lineTaxAmount,
  money,
  priceAfterProductDiscount,
  priceCatalogLine,
  quoteOrderTotals,
  quoteShipping,
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

  it("adds 17% tax after 17% product discount", () => {
    const store = { charge_tax_on_sales: true }
    const product = {
      tax_type: "percentage",
      tax_value: 17,
    }
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
