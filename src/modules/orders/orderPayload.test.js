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

test("every figure is saved as sent, even one that does not add up", () => {
  const order = clone(SAMPLE_ORDERS[0])
  // 100 with 5% off is 95; the till sent 92, a total of 107.1 and a tax of 17.1 — all kept as they are.
  order.order_items[0].subtotal = 92
  order.order_items[0].total = 107.1
  order.order_items[0].discount[0].value = 10
  order.summary.total_amount = 150
  order.summary.subtotal = 92
  const input = parseOrderV2(order)
  assert.equal(input.items[0].priced.subtotal, 92)
  assert.equal(input.items[0].priced.total, 107.1)
  assert.equal(input.items[0].priced.discount.amount, 5)
  assert.equal(input.total_amount, 150)
  assert.equal(input.lines_subtotal, 92)
})

test("a payment's surcharge and amount are saved as sent", () => {
  const off = clone(SAMPLE_ORDERS[2])
  off.payments[1].surcharge_amount = 4
  off.payments[1].amount = 54.05
  assert.deepEqual(parseOrderV2(off).payments.map((row) => row.surcharge_amount), [160, 4])
  const card = clone(SAMPLE_ORDERS[3])
  card.payments[0].amount = 893
  assert.equal(parseOrderV2(card).payments[0].amount, 893)
  const cash = clone(SAMPLE_ORDERS[0])
  cash.payments[0].amount = 118
  assert.equal(parseOrderV2(cash).payments[0].amount, 118)
})

test("the order discount amount is the summary's", () => {
  const order = clone(SAMPLE_ORDERS[0])
  order.summary.order_discount_amount = 12
  assert.equal(parseOrderV2(order).order_discount.amount, 12)
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

test("tax_exempt / discount_exempt, any qty and any discount type are accepted as sent", () => {
  const taxed = clone(SAMPLE_ORDERS[0])
  taxed.tax_exempt = true
  taxed.discount_exempt = true
  assert.equal(parseOrderV2(taxed).tax_exempt, true)
  const odd = clone(SAMPLE_ORDERS[0])
  odd.order_items[0].qty = 0
  odd.order_discount = { id: null, name: "Odd", type: "flat", value: 5 }
  const parsed = parseOrderV2(odd)
  assert.equal(parsed.items[0].quantity, 0)
  assert.equal(parsed.order_discount.type, "flat")
  // a qty that is not a number is 1; an unknown level is manual (its id kept, not checked)
  const loose = clone(SAMPLE_ORDERS[0])
  loose.order_items[0].qty = "abc"
  loose.order_items[0].discount = [{ id: 7, level: "festival", name: "Eid", type: "fixed", value: 5 }]
  loose.order_items[0].taxes = [{ id: null, level: "city", name: "City tax", type: "percentage", value: 1 }]
  const looseParsed = parseOrderV2(loose).items[0]
  assert.equal(looseParsed.quantity, 1)
  assert.equal(looseParsed.priced.discount.entries[0].level, "manual")
  assert.equal(looseParsed.priced.taxes[0].level, "manual")
  // a custom line without a name, sent with a product_id
  const custom = clone(SAMPLE_ORDERS[0])
  custom.order_items[0] = { ...custom.order_items[0], is_custom: true, name: undefined, variant_id: 3 }
  const customLine = parseOrderV2(custom).items[0]
  assert.equal(customLine.product_id, null)
  assert.equal(customLine.title, "Custom item")
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

test("payments are not checked against the bill; the total is the summary's", () => {
  const over = clone(SAMPLE_ORDERS[0])
  over.payments[0].bill_amount = 200
  over.payments[0].surcharge_amount = 32
  over.payments[0].amount = 232
  assert.equal(parseOrderV2(over).payments[0].bill_share, 200)
  const credit = clone(SAMPLE_ORDERS[2])
  credit.payments = [credit.payments[0]]
  credit.summary.surcharge_amount = 160
  // 1000 of the 1050.05 bill is paid, 50.05 stays as udhaar: the total is still the whole bill with the surcharge.
  credit.summary.total_amount = 1210.05
  assert.equal(parseOrderV2(credit).total_amount, 1210.05)
})
