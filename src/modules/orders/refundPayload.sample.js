/**
 * The four refunds of the POST /orders/refunds/bulk documentation (they refund the four orders of
 * orderPayload.sample.js): 1) partial, paid cash; 2) partial, paid by card; 3) complete, paid cash, with the order
 * discount; 4) complete, a split payment (cash 1160 + card 50.05). payments[] says how the shopkeeper gave the money back.
 * The tests parse them and the docs show them.
 */
export const SAMPLE_REFUNDS = [
  {
    local_id: "POS1-R-20261106-0001",
    refunded_at: "2026-11-06T13:00:00.000Z",
    order_id: 2,
    refund_type: "partial",
    reason: "Gift wrap not needed",
    currency: "PKR",
    refund_items: [
      { order_item_id: 1, qty: 1, gross_amount: 300, discount_amount: 30, subtotal: 270, tax_amount: 48.6, total: 318.6 },
    ],
    order_discount_amount: 0,
    total_payment_surcharge_refunded: 50.98,
    total_refunded_amount: 370,
    payments: [{ method: "cash", amount: 370 }],
  },
  {
    local_id: "POS1-R-20261106-0002",
    refunded_at: "2026-11-06T13:10:00.000Z",
    order_id: 4,
    refund_type: "partial",
    reason: "Customer return",
    currency: "PKR",
    refund_items: [
      { order_item_id: 4, qty: 1, gross_amount: 200, discount_amount: 100, subtotal: 100, tax_amount: 23, total: 123 },
    ],
    order_discount_amount: 0,
    total_payment_surcharge_refunded: 9.84,
    total_refunded_amount: 132.84,
    payments: [{ method: "card", amount: 132.84 }],
  },
  {
    local_id: "POS1-R-20261107-0001",
    refunded_at: "2026-11-07T09:00:00.000Z",
    order_id: 1,
    refund_type: "complete",
    reason: "Customer changed mind",
    currency: "PKR",
    refund_items: [
      { order_item_id: 1, qty: 1, gross_amount: 100, discount_amount: 5, subtotal: 95, tax_amount: 17.1, total: 112.1 },
    ],
    order_discount_amount: 11.21,
    total_payment_surcharge_refunded: 16.14,
    total_refunded_amount: 117,
    payments: [{ method: "cash", amount: 117 }],
  },
  {
    local_id: "POS1-R-20261107-0002",
    refunded_at: "2026-11-07T10:00:00.000Z",
    order_id: 3,
    refund_type: "complete",
    reason: "Wrong item",
    currency: "PKR",
    refund_items: [
      { order_item_id: 1, qty: 1, gross_amount: 1100, discount_amount: 165, subtotal: 935, tax_amount: 215.05, total: 1150.05 },
    ],
    order_discount_amount: 100,
    total_payment_surcharge_refunded: 160,
    total_refunded_amount: 1210.05,
    payments: [
      { method: "cash", amount: 1160 },
      { method: "card", amount: 50.05 },
    ],
  },
]

/** The body of POST /orders/refunds/bulk. */
export const SAMPLE_REFUND_BODY = { storeId: 1, locationId: 1, staffId: 1, batchId: 1, refunds: SAMPLE_REFUNDS }
