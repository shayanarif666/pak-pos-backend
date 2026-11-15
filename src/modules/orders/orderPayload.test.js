import test from "node:test"
import assert from "node:assert/strict"
import { parseOrderV2 } from "./orderPayload.js"
import { SAMPLE_ORDERS } from "./orderPayload.sample.js"

const clone = (value) => JSON.parse(JSON.stringify(value))
const fails = (order, pattern) => assert.throws(() => parseOrderV2(order), (error) => pattern.test(error.message) && error.statusCode === 400)

test("the four sample orders add up", () => {
  for (const order of SAMPLE_ORDERS) {
    const input = parseOrderV2(clone(order))
    assert.equal(input.total_amount, order.summary.total_amount)
    assert.equal(input.items.length, order.order_items.length)
  }
})

test("an order discount is a share of the lines' totals together", () => {
  const input = parseOrderV2(clone(SAMPLE_ORDERS[0]))
  assert.equal(input.order_discount.amount, 11.21)
  const fixed = parseOrderV2(clone(SAMPLE_ORDERS[2]))
  assert.equal(fixed.order_discount.amount, 100)
})

test("the split payment pays the bill, only the surcharge that is on is charged", () => {
  const input = parseOrderV2(clone(SAMPLE_ORDERS[2]))
  assert.equal(input.payment_method, "mixed")
  assert.deepEqual(input.payments.map((row) => row.surcharge_amount), [160, 0])
})

test("two bundles in one order", () => {
  const input = parseOrderV2(clone(SAMPLE_ORDERS[3]))
  assert.deepEqual(input.bundles.map((bundle) => bundle.id), [1, 2])
  assert.deepEqual(input.items.map((line) => `${line.bundle_id}:${line.bundle_role}`), ["1:buy", "1:reward", "2:buy", "2:buy"])
})

test("a figure that does not add up is refused", () => {
  const wrongTotal = clone(SAMPLE_ORDERS[0])
  wrongTotal.order_items[0].total = 120
  fails(wrongTotal, /order_items\[0\]\.total/)
  const wrongDiscount = clone(SAMPLE_ORDERS[0])
  wrongDiscount.order_items[0].discount[0].value = 10
  fails(wrongDiscount, /discount_amount/)
  const wrongTax = clone(SAMPLE_ORDERS[0])
  wrongTax.order_items[0].taxes[0].value = 5
  fails(wrongTax, /tax_amount/)
  const wrongSummary = clone(SAMPLE_ORDERS[0])
  wrongSummary.summary.total_amount = 150
  fails(wrongSummary, /summary\.total_amount/)
  const wrongSurcharge = clone(SAMPLE_ORDERS[0])
  wrongSurcharge.payments[0].surcharge_amount = 16.1
  wrongSurcharge.payments[0].amount = 117
  wrongSurcharge.summary.surcharge_amount = 16.1
  fails(wrongSurcharge, /surcharge_amount/)
})

test("a surcharge that is off must be 0", () => {
  const order = clone(SAMPLE_ORDERS[2])
  order.payments[1].surcharge_amount = 4
  order.payments[1].amount = 54.05
  fails(order, /surcharge_active is false/)
})

test("cash is rounded to the rupee, a card is exact", () => {
  const card = clone(SAMPLE_ORDERS[3])
  card.payments[0].amount = 893
  fails(card, /payments\[0\]\.amount/)
  const cash = clone(SAMPLE_ORDERS[0])
  cash.payments[0].amount = 118
  fails(cash, /payments\[0\]\.amount/)
})

test("ids: category / product / variant / manual have none, store / bulk / bundle discounts need one", () => {
  const owned = clone(SAMPLE_ORDERS[0])
  owned.order_items[0].discount[0].id = 3
  fails(owned, /has no id/)
  const picked = clone(SAMPLE_ORDERS[2])
  picked.order_items[0].discount[1].id = null
  fails(picked, /needs its id/)
  // A custom line may send either.
  const custom = clone(SAMPLE_ORDERS[1])
  custom.order_items[0].discount[0].id = null
  assert.equal(parseOrderV2(custom).items[0].priced.discount.entries[0].id, null)
})

test("tax_exempt and discount_exempt", () => {
  const taxed = clone(SAMPLE_ORDERS[0])
  taxed.tax_exempt = true
  fails(taxed, /tax_exempt is true/)
  const discounted = clone(SAMPLE_ORDERS[0])
  discounted.discount_exempt = true
  fails(discounted, /discount_exempt is true/)
})

test("bundles must match the lines", () => {
  const missing = clone(SAMPLE_ORDERS[3])
  missing.bundles = [missing.bundles[0]]
  fails(missing, /not in bundles/)
  const unused = clone(SAMPLE_ORDERS[3])
  unused.order_items = unused.order_items.filter((line) => line.bundle_id !== 2)
  unused.summary = { ...unused.summary, gross_amount: 560, items_discount_amount: 120, subtotal: 440, tax_amount: 123.2, surcharge_amount: 0, total_amount: 563.2 }
  unused.payments = [{ method: "cash", bill_amount: 563.2, surcharge_active: false, type: null, value: 0, surcharge_amount: 0, amount: 563, paid: 600 }]
  fails(unused, /on no line/)
})

test("the payments cannot pay more than the bill; paying less is udhaar", () => {
  const over = clone(SAMPLE_ORDERS[0])
  over.payments[0].bill_amount = 200
  over.payments[0].surcharge_amount = 32
  over.payments[0].amount = 232
  fails(over, /more than the bill/)
  const credit = clone(SAMPLE_ORDERS[2])
  credit.payments = [credit.payments[0]]
  credit.summary.surcharge_amount = 160
  // 1000 of the 1050.05 bill is paid, 50.05 stays as udhaar: the total is still the whole bill with the surcharge.
  credit.summary.total_amount = 1210.05
  assert.equal(parseOrderV2(credit).total_amount, 1210.05)
})
