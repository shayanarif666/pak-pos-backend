/**
 * The four orders of the POST /orders/bulk documentation, every figure worked out by the rules in
 * orderPayload.js: 1) one payment, 2) a custom sale, 3) a split payment, 4) two bundles in one order.
 * The tests parse them (so the figures are checked) and the docs show them.
 */
const GST = { id: 1, level: "store", name: "GST", type: "percentage", value: 18 }
const tax = (level, name, value) => ({ id: null, level, name, type: "percentage", value })
const bundleDiscount = (id, name, value) => ({ id, level: "bundle", name, type: "percentage", value })

const BUNDLE_1 = "Buy 2 Litre Pepsi Get 1 500ml Free"
const BUNDLE_2 = "Buy 1 Litre & 1 Litre Mountain Dew Get 50% Off"

export const SAMPLE_ORDERS = [
  // 1) Several levels on one line, an order discount from the Discounts page, paid in cash with the cash surcharge on.
  {
    local_id: "POS1-20261106-0001",
    placed_at: "2026-11-06T10:05:00.000Z",
    customer_id: null,
    tax_exempt: false,
    discount_exempt: false,
    order_items: [
      {
        product_id: 1, variant_id: 1, sale_unit: "unit", qty: 1, price: 100,
        gross_amount: 100,
        discount: [{ id: null, level: "category", name: "Beverages 5% off", type: "percentage", value: 5 }],
        discount_amount: 5,
        subtotal: 95,
        taxes: [GST],
        tax_amount: 17.1,
        total: 112.1,
      },
    ],
    order_discount: { id: 1, name: "Azaadi Sale", type: "percentage", value: 10 },
    payments: [
      { method: "cash", bill_amount: 100.89, surcharge_active: true, type: "percentage", value: 16, surcharge_amount: 16.14, amount: 117, paid: 150 },
    ],
    summary: {
      currency: "PKR",
      total_items: 1, gross_amount: 100, items_discount_amount: 5, subtotal: 95,
      order_discount_amount: 11.21, tax_amount: 17.1, surcharge_amount: 16.14,
      total_amount: 117,
    },
  },

  // 2) A custom sale: not in the catalog, so no product_id; the shopkeeper's discount and tax go on it with or without an id.
  {
    local_id: "POS1-20261106-0002",
    placed_at: "2026-11-06T11:20:00.000Z",
    customer_id: null,
    tax_exempt: false,
    discount_exempt: false,
    order_items: [
      {
        is_custom: true, name: "Gift wrapping", product_id: null, variant_id: null,
        sale_unit: "unit", qty: 2, price: 300,
        gross_amount: 600,
        discount: [{ id: 2, level: "store", name: "Azaadi Sale", type: "percentage", value: 10 }],
        discount_amount: 60,
        subtotal: 540,
        taxes: [GST],
        tax_amount: 97.2,
        total: 637.2,
      },
    ],
    order_discount: null,
    payments: [
      { method: "cash", bill_amount: 637.2, surcharge_active: true, type: "percentage", value: 16, surcharge_amount: 101.95, amount: 739, paid: 1000 },
    ],
    summary: {
      currency: "PKR",
      total_items: 1, gross_amount: 600, items_discount_amount: 60, subtotal: 540,
      order_discount_amount: 0, tax_amount: 97.2, surcharge_amount: 101.95,
      total_amount: 739,
    },
  },

  // 3) Split payment: cash (surcharge on) and card (its surcharge is off, so 0); a manual order discount.
  {
    local_id: "POS1-20261106-0003",
    placed_at: "2026-11-06T12:00:00.000Z",
    customer_id: null,
    tax_exempt: false,
    discount_exempt: false,
    order_items: [
      {
        product_id: 1, variant_id: 4, sale_unit: "pack", qty: 1, price: 1100,
        gross_amount: 1100,
        discount: [
          { id: null, level: "variant", name: "Pepsi pack sale", type: "percentage", value: 5 },
          { id: 2, level: "store", name: "Azaadi Sale", type: "percentage", value: 10 },
        ],
        discount_amount: 165,
        subtotal: 935,
        taxes: [GST, tax("product", "Import Tax", 5)],
        tax_amount: 215.05,
        total: 1150.05,
      },
    ],
    order_discount: { id: null, name: "Manager discount", type: "fixed", value: 100 },
    // A cashier needs an approved discount_override request for a manual order discount (a manager / store admin does not).
    approval_request_id: "6f1e8a52-3c1d-4a7e-9b4e-2d5a8c7f1b90",
    payments: [
      { method: "cash", bill_amount: 1000, surcharge_active: true, type: "percentage", value: 16, surcharge_amount: 160, amount: 1160, paid: 1200 },
      { method: "card", bill_amount: 50.05, surcharge_active: false, type: "percentage", value: 8, surcharge_amount: 0, amount: 50.05, paid: 50.05 },
    ],
    summary: {
      currency: "PKR",
      total_items: 1, gross_amount: 1100, items_discount_amount: 165, subtotal: 935,
      order_discount_amount: 100, tax_amount: 215.05, surcharge_amount: 160,
      total_amount: 1210.05,
    },
  },

  // 4) Two bundles in one order: bundle 1 (2 x Pepsi 1L, a 500ml free) and bundle 2 (Pepsi 1L + Mountain Dew 1L, 50% off).
  {
    local_id: "POS1-20261106-0004",
    placed_at: "2026-11-06T13:10:00.000Z",
    customer_id: null,
    tax_exempt: false,
    discount_exempt: false,
    order_items: [
      {
        product_id: 1, variant_id: 3, sale_unit: "unit", qty: 2, price: 220,
        bundle_id: 1, bundle_role: "buy",
        gross_amount: 440,
        discount: [],
        discount_amount: 0,
        subtotal: 440,
        taxes: [GST, tax("category", "GST", 5), tax("product", "Import Tax", 5)],
        tax_amount: 123.2,
        total: 563.2,
      },
      {
        product_id: 1, variant_id: 2, sale_unit: "unit", qty: 1, price: 120,
        bundle_id: 1, bundle_role: "reward",
        gross_amount: 120,
        discount: [bundleDiscount(1, BUNDLE_1, 100)],
        discount_amount: 120,
        subtotal: 0,
        taxes: [GST, tax("category", "GST", 5), tax("product", "Import Tax", 5)],
        tax_amount: 0,
        total: 0,
      },
      {
        product_id: 1, variant_id: 3, sale_unit: "unit", qty: 1, price: 220,
        bundle_id: 2, bundle_role: "buy",
        gross_amount: 220,
        discount: [bundleDiscount(2, BUNDLE_2, 50)],
        discount_amount: 110,
        subtotal: 110,
        taxes: [GST, tax("category", "GST", 5), tax("product", "Import Tax", 5)],
        tax_amount: 30.8,
        total: 140.8,
      },
      {
        product_id: 5, variant_id: 1, sale_unit: "unit", qty: 1, price: 200,
        bundle_id: 2, bundle_role: "buy",
        gross_amount: 200,
        discount: [bundleDiscount(2, BUNDLE_2, 50)],
        discount_amount: 100,
        subtotal: 100,
        taxes: [GST, tax("category", "GST", 5)],
        tax_amount: 23,
        total: 123,
      },
    ],
    bundles: [
      { id: 1, name: BUNDLE_1, reward_type: "free_item", value: null },
      { id: 2, name: BUNDLE_2, reward_type: "percentage", value: 50 },
    ],
    order_discount: null,
    payments: [
      { method: "card", bill_amount: 827, surcharge_active: true, type: "percentage", value: 8, surcharge_amount: 66.16, amount: 893.16, paid: 893.16 },
    ],
    summary: {
      currency: "PKR",
      total_items: 4, gross_amount: 980, items_discount_amount: 330, subtotal: 650,
      order_discount_amount: 0, tax_amount: 177, surcharge_amount: 66.16,
      total_amount: 893.16,
    },
  },
]

/** The body of POST /orders/bulk. */
export const SAMPLE_BODY = { storeId: 1, locationId: 1, staffId: 2, batchId: 1, orders: SAMPLE_ORDERS }
