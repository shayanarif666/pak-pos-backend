import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  applyDiscount,
  bogoFreeQty,
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

  it("computes BOGO free qty in groups", () => {
    assert.equal(bogoFreeQty(3, 2, 1), 1)
    assert.equal(bogoFreeQty(5, 2, 1), 1)
    assert.equal(bogoFreeQty(6, 2, 1), 2)
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
