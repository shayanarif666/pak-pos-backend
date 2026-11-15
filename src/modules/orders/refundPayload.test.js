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
    assert.equal(input.payments.length, refund.payments.length)
  }
})

test("a split payment refund pays each method", () => {
  const input = parseRefundV2(clone(SAMPLE_REFUNDS[3]))
  assert.deepEqual(input.payments.map((row) => [row.method, row.return_amount]), [["cash", 1160], ["card", 50.05]])
  assert.equal(input.surcharge_total, 160)
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

test("a line that does not add up is refused", () => {
  const subtotal = clone(SAMPLE_REFUNDS[0])
  subtotal.refund_items[0].subtotal = 250
  fails(subtotal, /subtotal/)
  const total = clone(SAMPLE_REFUNDS[0])
  total.refund_items[0].total = 300
  fails(total, /\.total/)
})

test("the payments must add up to total_refunded_amount", () => {
  const refund = clone(SAMPLE_REFUNDS[3])
  refund.total_refunded_amount = 370
  fails(refund, /not the sum of the payments/)
})

test("a line or a method listed twice is refused", () => {
  const line = clone(SAMPLE_REFUNDS[0])
  line.refund_items.push(clone(line.refund_items[0]))
  fails(line, /listed twice/)
  const method = clone(SAMPLE_REFUNDS[3])
  method.payments[1].method = "cash"
  fails(method, /twice/)
})
