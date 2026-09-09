import { env } from "../../config/env.js"
import { registerModels } from "../../db/registerModels.js"
import { sequelize } from "../../db/sequelize.js"

registerModels()

const BASE = `http://127.0.0.1:${env.PORT}/api/v1`
const stamp = Date.now()

async function req(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" }
  if (token) headers.Authorization = "Bearer " + token
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

function assert(cond, msg, extra) {
  if (!cond) {
    console.error("FAIL", msg, extra === undefined ? "" : extra)
    process.exit(1)
  }
}

async function login(email, password, extra = {}) {
  const res = await req("POST", "/auth/login", {
    body: { email, password, ...extra },
  })
  assert(res.status === 200, "login " + email, res)
  return res.json.data.access_token
}

function storePayload(planId, code) {
  return {
    plan_id: planId,
    name: "Phase9 " + code + " " + stamp,
    slug: "p9-" + code + "-" + stamp,
    business_type: "grocery",
    address: "1 Test Street",
    city: "Lahore",
    contact_email: code + "-" + stamp + "@p9.local",
    contact_phone: "+923001111111",
    location_name: "Main Counter",
    admin_name: "Admin " + code,
    admin_email: "admin-" + code + "-" + stamp + "@p9.local",
    admin_password: "secret12",
    admin_pin: "1111",
    manager_name: "Mgr " + code,
    manager_email: "mgr-" + code + "-" + stamp + "@p9.local",
    manager_password: "secret12",
    manager_pin: "2222",
    billing_status: "paid",
    amount: 0,
  }
}

await sequelize.authenticate()

const sa = await login(env.SUPERADMIN_EMAIL, env.SUPERADMIN_PASSWORD)
const plans = await req("GET", "/plans", { token: sa })
const p1 = plans.json.data.find((p) => p.code === "package_1")
const p2 = plans.json.data.find((p) => p.code === "package_2")

const reg1 = await req("POST", "/admin/stores", {
  token: sa,
  body: storePayload(p1.id, "p1"),
})
assert(reg1.status === 201, "register p1", reg1)
const loc1 = reg1.json.data.location.id
const license1 = reg1.json.data.license.license_key

const device = await req("POST", "/licenses/validate", {
  body: {
    license_key: license1,
    device_uid: "pc-p9-" + stamp,
    name: "Till 1",
    location_id: loc1,
    platform: "win32",
  },
})
assert(device.status === 200 && device.json.data.device, "device", device)

const mgr = await login("mgr-p1-" + stamp + "@p9.local", "secret12", {
  channel: "pos",
  license_key: license1,
})

const blocked = await req("POST", "/orders", {
  token: mgr,
  body: {
    channel: "pos",
    location_id: loc1,
    items: [{ product_id: "11111111-1111-4111-8111-111111111111", quantity: 1 }],
    payment_method: "cash",
  },
})
assert(blocked.status === 409, "sale without clock-in", blocked)

const session = await req("POST", "/register-sessions", {
  token: mgr,
  body: { opening_cash: 1000, location_id: loc1, device_id: device.json.data.device.id },
})
assert(session.status === 201, "clock in", session)

const admin = await login("admin-p1-" + stamp + "@p9.local", "secret12")
const cat = await req("POST", "/categories", { token: admin, body: { name: "Grocery" } })
const product = await req("POST", "/products", {
  token: admin,
  body: {
    title: "Rice",
    sku: "RICE-P9-" + stamp,
    category_id: cat.json.data.id,
    cost_price: 400,
    selling_price: 500,
  },
})
await req("PUT", "/product-stocks/" + product.json.data.id, {
  token: admin,
  body: { location_id: loc1, qty: 20, reason: "opening_balance" },
})

const sale = await req("POST", "/orders", {
  token: mgr,
  body: {
    channel: "pos",
    location_id: loc1,
    items: [{ product_id: product.json.data.id, quantity: 2 }],
    payments: [
      { method: "cash", amount: 600 },
      { method: "card", amount: 400 },
    ],
    total_amount: 1,
  },
})
assert(sale.status === 201, "split sale", sale)
assert(sale.json.data.order.payment_method === "mixed", "mixed", sale)
assert(Number(sale.json.data.order.total_amount) === 1000, "server total", sale)
assert(sale.json.data.payments.length === 2, "two payments", sale)
assert(sale.json.data.receipt, "receipt", sale)

const receipt = await req("GET", "/receipts/" + sale.json.data.receipt.id, {
  token: mgr,
})
assert(receipt.status === 200, "get receipt", receipt)
assert(receipt.json.data.items.length === 1, "receipt lines", receipt)

const viaOrder = await req("GET", "/orders/" + sale.json.data.order.id + "/receipt", {
  token: mgr,
})
assert(viaOrder.status === 200, "order receipt", viaOrder)

const stocks = await req("GET", "/product-stocks?location_id=" + loc1, { token: admin })
const afterSale = stocks.json.data.find((s) => s.product_id === product.json.data.id)
assert(Number(afterSale.qty) === 18, "stock after sale", afterSale)

const custom = await req("POST", "/orders", {
  token: mgr,
  body: {
    channel: "pos",
    location_id: loc1,
    is_custom: true,
    items: [{ title: "Loose bag", quantity: 1, unit_price: 75 }],
    payment_method: "cash",
  },
})
assert(custom.status === 201, "custom", custom)
const stocks2 = await req("GET", "/product-stocks?location_id=" + loc1, { token: admin })
const afterCustom = stocks2.json.data.find((s) => s.product_id === product.json.data.id)
assert(Number(afterCustom.qty) === 18, "custom skips stock", afterCustom)

const customList = await req("GET", "/orders/custom", { token: mgr })
assert(customList.json.data.some((o) => o.id === custom.json.data.order.id), "custom list")

const p1Approval = await req("POST", "/approval-requests", {
  token: mgr,
  body: { type: "void_order", order_id: sale.json.data.order.id },
})
assert(p1Approval.status === 403, "p1 approval 403", p1Approval)

const voided = await req("POST", "/orders/" + sale.json.data.order.id + "/void", {
  token: mgr,
  body: { reason: "customer return" },
})
assert(voided.status === 200, "manager void p1", voided)
const stocks3 = await req("GET", "/product-stocks?location_id=" + loc1, { token: admin })
const afterVoid = stocks3.json.data.find((s) => s.product_id === product.json.data.id)
assert(Number(afterVoid.qty) === 20, "void restock", afterVoid)

const cancelled = await req("GET", "/orders/cancelled", { token: admin })
assert(cancelled.json.data.count >= 1, "cancelled list", cancelled)

const closed = await req("POST", "/register-sessions/" + session.json.data.id + "/clock-out", {
  token: mgr,
  body: {
    note_1000_count: 1,
    coins_total: 75,
    closing_cash: 1075,
  },
})
assert(closed.status === 200, "clock out", closed)
assert(Number(closed.json.data.expected_cash) === 1075, "expected cash", closed)
assert(Number(closed.json.data.cash_variance) === 0, "variance 0", closed)

const soldAfterClose = await req("POST", "/orders", {
  token: mgr,
  body: {
    channel: "pos",
    location_id: loc1,
    is_custom: true,
    items: [{ title: "After close", quantity: 1, unit_price: 10 }],
    payment_method: "cash",
  },
})
assert(soldAfterClose.status === 409, "no sale after clock-out", soldAfterClose)

const reg2 = await req("POST", "/admin/stores", {
  token: sa,
  body: storePayload(p2.id, "p2"),
})
assert(reg2.status === 201, "register p2", reg2)
const loc2 = reg2.json.data.location.id
const license2 = reg2.json.data.license.license_key
const admin2 = await login("admin-p2-" + stamp + "@p9.local", "secret12")
const act2 = await req("POST", "/licenses/validate", {
  body: {
    license_key: license2,
    device_uid: "pc-p9-b-" + stamp,
    name: "Till 2",
    location_id: loc2,
  },
})
assert(act2.status === 200 && act2.json.data.device, "activate p2", act2)
const mgr2 = await login("mgr-p2-" + stamp + "@p9.local", "secret12", {
  channel: "pos",
  license_key: license2,
})
const cashier = await req("POST", "/staff", {
  token: admin2,
  body: {
    name: "Cashier",
    email: "cash-p2-" + stamp + "@p9.local",
    password: "secret12",
    pin: "3333",
    role: "cashier",
    location_id: loc2,
  },
})
assert(cashier.status === 201, "cashier", cashier)
const cashTok = await login("cash-p2-" + stamp + "@p9.local", "secret12", {
  channel: "pos",
  license_key: license2,
})
await req("POST", "/register-sessions", {
  token: cashTok,
  body: { opening_cash: 200, location_id: loc2 },
})
const cat2 = await req("POST", "/categories", { token: admin2, body: { name: "Dry" } })
const prod2 = await req("POST", "/products", {
  token: admin2,
  body: {
    title: "Flour",
    sku: "FLOUR-P9-" + stamp,
    category_id: cat2.json.data.id,
    cost_price: 80,
    selling_price: 100,
  },
})
await req("PUT", "/product-stocks/" + prod2.json.data.id, {
  token: admin2,
  body: { location_id: loc2, qty: 10, reason: "opening_balance" },
})
const sale2 = await req("POST", "/orders", {
  token: cashTok,
  body: {
    channel: "pos",
    location_id: loc2,
    items: [{ product_id: prod2.json.data.id, quantity: 1 }],
    payment_method: "cash",
  },
})
assert(sale2.status === 201, "p2 sale", sale2)

const cashierVoid = await req("POST", "/orders/" + sale2.json.data.order.id + "/void", {
  token: cashTok,
  body: { reason: "oops" },
})
assert(cashierVoid.status === 403, "cashier void needs approval", cashierVoid)

const asked = await req("POST", "/approval-requests", {
  token: cashTok,
  body: {
    type: "void_order",
    order_id: sale2.json.data.order.id,
    reason: "wrong item",
  },
})
assert(asked.status === 201, "ask approval", asked)
const reviewed = await req("PATCH", "/approval-requests/" + asked.json.data.id, {
  token: mgr2,
  body: { status: "approved", review_note: "ok" },
})
assert(reviewed.status === 200, "approve", reviewed)
const void2 = await req("POST", "/orders/" + sale2.json.data.order.id + "/void", {
  token: cashTok,
  body: {
    reason: "wrong item",
    approval_request_id: asked.json.data.id,
  },
})
assert(void2.status === 200, "cashier void after approval", void2)

const override = await req("POST", "/approvals/pin-override", {
  token: mgr2,
  body: { pin: "2222", type: "pin_override", location_id: loc2 },
})
assert(override.status === 200, "pin override", override)

await sequelize.close()
console.log("PHASE9_E2E_OK")
