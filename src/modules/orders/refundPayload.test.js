import test from "node:test"
import assert from "node:assert/strict"
import { parseRefundV2 } from "./refundPayload.js"
import { SAMPLE_REFUNDS } from "./refundPayload.sample.js"

const clone = (value) => JSON.parse(JSON.stringify(value))
const fails = (refund, pattern) => assert.throws(() => parseRefundV2(refund), (error) => pattern.test(error.message) && error.statusCode === 400)

test("the four sample refunds parse", () => {
  for (const refund of SAMPLE_REFUNDS) {
    const input = parseRefundV2(clone(refund))
    assert.equal(input.total_amount, refund.total_refunded_amount)
    assert.equal(input.refund_type, refund.refund_type)
    assert.deepEqual(input.payments, [])
  }
})

test("payments is not needed; when sent it is saved as sent", () => {
  const input = parseRefundV2(clone(SAMPLE_REFUNDS[3]))
  assert.equal(input.surcharge_total, 160)
  assert.equal(input.total_amount, 1210.05)
  const sent = clone(SAMPLE_REFUNDS[3])
  sent.payments = [{ method: "cash", return_amount: 1160 }, { method: "card", return_amount: 50.05 }]
  assert.deepEqual(parseRefundV2(sent).payments.map((row) => [row.method, row.return_amount]), [["cash", 1160], ["card", 50.05]])
})

test("refund_type, reason and local_id are required", () => {
  const noType = clone(SAMPLE_REFUNDS[0])
  delete noType.refund_type
  fails(noType, /refund_type/)
  const noReason = clone(SAMPLE_REFUNDS[0])
  noReason.reason = ""
  fails(noReason, /reason/)
  const noId = clone(SAMPLE_REFUNDS[0])
  delete noId.local_id
  fails(noId, /local_id/)
})

test("a line's figures are saved as sent, even ones that do not add up", () => {
  const refund = clone(SAMPLE_REFUNDS[0])
  refund.refund_items[0].subtotal = 250
  refund.refund_items[0].total = 300
  const input = parseRefundV2(refund)
  assert.equal(input.items[0].subtotal, 250)
  assert.equal(input.items[0].total, 300)
})

test("the payments are not checked against total_refunded_amount", () => {
  const refund = clone(SAMPLE_REFUNDS[3])
  refund.payments = [{ method: "cash", return_amount: 1160 }, { method: "card", return_amount: 50.05 }]
  refund.total_refunded_amount = 370
  assert.equal(parseRefundV2(refund).total_amount, 370)
})

test("a line or a method listed twice is refused", () => {
  const line = clone(SAMPLE_REFUNDS[0])
  line.refund_items.push(clone(line.refund_items[0]))
  fails(line, /listed twice/)
  const method = clone(SAMPLE_REFUNDS[3])
  method.payments = [{ method: "cash", return_amount: 1160 }, { method: "cash", return_amount: 50.05 }]
  fails(method, /twice/)
})

test("missing amounts are 0 and line taxes are kept as sent", () => {
  const input = parseRefundV2({
    local_id: "R-X", order_id: 1, refund_type: "partial", reason: "x",
    refund_items: [{ order_item_id: 1, qty: 1, taxes: [{ level: "store", name: "GST", type: "percentage", value: 18, amount: 2.5 }] }],
  })
  assert.equal(input.total_amount, 0)
  assert.equal(input.items[0].total, 0)
  assert.equal(input.surcharge_total, null)
  assert.deepEqual(input.items[0].taxes, [{ level: "store", name: "GST", type: "percentage", rate: 18, amount: 2.5 }])
})
