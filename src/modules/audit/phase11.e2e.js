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
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  return { status: res.status, json, text }
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
    name: "Phase11 " + code + " " + stamp,
    slug: "p11-" + code + "-" + stamp,
    business_type: "grocery",
    address: "1 Report Street",
    city: "Lahore",
    contact_email: code + "-" + stamp + "@p11.local",
    contact_phone: "+923001111111",
    location_name: "Main Counter",
    admin_name: "Admin " + code,
    admin_email: "admin-" + code + "-" + stamp + "@p11.local",
    admin_password: "secret12",
    admin_pin: "1111",
    manager_name: "Mgr " + code,
    manager_email: "mgr-" + code + "-" + stamp + "@p11.local",
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
const managerId = reg1.json.data.manager.id

const admin = await login("admin-p1-" + stamp + "@p11.local", "secret12")
const extraLoc = await req("POST", "/locations", {
  token: admin,
  body: { name: "Branch 2", city: "Lahore", address_line: "2 Test" },
})
assert(extraLoc.status === 409, "p1 second location", extraLoc)

const device1 = await req("POST", "/licenses/validate", {
  body: {
    license_key: license1,
    device_uid: "pc-p11-a-" + stamp,
    name: "Till 1",
    location_id: loc1,
    platform: "win32",
  },
})
assert(device1.status === 200 && device1.json.data.device, "first device", device1)
const device2 = await req("POST", "/licenses/validate", {
  body: {
    license_key: license1,
    device_uid: "pc-p11-b-" + stamp,
    name: "Till 2",
    location_id: loc1,
    platform: "win32",
  },
})
assert(device2.status === 409, "second device on same key blocked", device2)

const mgr = await login("mgr-p1-" + stamp + "@p11.local", "secret12", {
  channel: "pos",
  license_key: license1,
})
const session = await req("POST", "/register-sessions", {
  token: mgr,
  body: { opening_cash: 500, location_id: loc1 },
})
assert(session.status === 201, "clock in", session)

const cat = await req("POST", "/categories", { token: admin, body: { name: "Dry" } })
const product = await req("POST", "/products", {
  token: admin,
  body: {
    title: "Flour",
    sku: "FLOUR-P11-" + stamp,
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
    payment_method: "cash",
  },
})
assert(sale.status === 201, "p1 sale", sale)

const patched = await req("PATCH", "/products/" + product.json.data.id, {
  token: admin,
  body: { cost_price: 1 },
})
assert(patched.status === 200, "change live cost", patched)

const profit = await req("GET", "/reports/profit", { token: admin })
assert(profit.status === 200, "profit report", profit)
assert(Number(profit.json.data.totals.cost) === 800, "snapshot cost 800", profit)
assert(Number(profit.json.data.totals.revenue) === 1000, "revenue 1000", profit)
assert(Number(profit.json.data.totals.gross_profit) === 200, "gp 200", profit)
assert(profit.json.data.cost_source === "order_items.cost_price", "cost source", profit)

const sales = await req("GET", "/reports/sales", { token: admin })
assert(Number(sales.json.data.totals.revenue) === 1000, "sales revenue", sales)
assert(sales.json.data.totals.orders === 1, "one sale", sales)

const pays = await req("GET", "/reports/payments", { token: admin })
const cash = pays.json.data.rows.find((row) => row.method === "cash")
assert(cash && Number(cash.amount) === 1000, "cash payments", pays)

const staffSales = await req("GET", "/staff/" + managerId + "/sales", { token: admin })
assert(staffSales.status === 200, "staff sales", staffSales)
assert(staffSales.json.data.orders.length >= 1, "staff has sale", staffSales)

const blockedExport = await req("GET", "/reports/export?type=profit&format=csv", {
  token: admin,
})
assert(blockedExport.status === 403, "p1 export blocked", blockedExport)

const offline = await req("POST", "/orders", {
  token: mgr,
  body: {
    channel: "pos",
    location_id: loc1,
    items: [{ product_id: product.json.data.id, quantity: 1 }],
    payment_method: "cash",
    client_local_id: "offline-p1-" + stamp,
  },
})
assert(offline.status === 403, "p1 offline blocked", offline)

const logs = await req("GET", "/audit-logs?action=sale", { token: admin })
assert(logs.status === 200, "store audit", logs)
assert(
  logs.json.data.some((row) => row.entity_id === sale.json.data.order.id),
  "sale audit",
  logs
)
const leaked = JSON.stringify(logs.json.data)
assert(!leaked.includes("secret12"), "no password in audit", logs)
assert(!/"pin"\s*:\s*"\d+/.test(leaked), "no pin in audit", logs)

const mutate = await req("PATCH", "/audit-logs/" + logs.json.data[0].id, {
  token: admin,
  body: { note: "tamper" },
})
assert(mutate.status === 404, "no audit patch", mutate)
const gone = await req("DELETE", "/audit-logs/" + logs.json.data[0].id, { token: admin })
assert(gone.status === 404, "no audit delete", gone)

const reg2 = await req("POST", "/admin/stores", {
  token: sa,
  body: storePayload(p2.id, "p2"),
})
assert(reg2.status === 201, "register p2", reg2)
const loc2 = reg2.json.data.location.id
const license2 = reg2.json.data.license.license_key
const admin2 = await login("admin-p2-" + stamp + "@p11.local", "secret12")
const act2 = await req("POST", "/licenses/validate", {
  body: {
    license_key: license2,
    device_uid: "pc-p11-b-" + stamp,
    name: "Till 2",
    location_id: loc2,
  },
})
assert(act2.status === 200 && act2.json.data.device, "activate p2", act2)
const mgr2 = await login("mgr-p2-" + stamp + "@p11.local", "secret12", {
  channel: "pos",
  license_key: license2,
})
await req("POST", "/register-sessions", {
  token: mgr2,
  body: { opening_cash: 200, location_id: loc2 },
})
const cat2 = await req("POST", "/categories", { token: admin2, body: { name: "Oil" } })
const prod2 = await req("POST", "/products", {
  token: admin2,
  body: {
    title: "Oil",
    sku: "OIL-P11-" + stamp,
    category_id: cat2.json.data.id,
    cost_price: 80,
    selling_price: 100,
  },
})
await req("PUT", "/product-stocks/" + prod2.json.data.id, {
  token: admin2,
  body: { location_id: loc2, qty: 10, reason: "opening_balance" },
})
const offlineOk = await req("POST", "/orders", {
  token: mgr2,
  body: {
    channel: "pos",
    location_id: loc2,
    items: [{ product_id: prod2.json.data.id, quantity: 1 }],
    payment_method: "cash",
    client_local_id: "offline-p2-" + stamp,
  },
})
assert(offlineOk.status === 201, "p2 offline sale", offlineOk)
const replay = await req("POST", "/orders", {
  token: mgr2,
  body: {
    channel: "pos",
    location_id: loc2,
    items: [{ product_id: prod2.json.data.id, quantity: 1 }],
    payment_method: "cash",
    client_local_id: "offline-p2-" + stamp,
  },
})
assert(replay.status === 200, "offline replay", replay)

const exported = await req("GET", "/reports/export?type=profit&format=csv", {
  token: admin2,
})
assert(exported.status === 200, "p2 export csv", exported)
assert(String(exported.text).includes("gross_profit"), "csv body", exported)

const xlsx = await req("GET", "/reports/export?type=sales&format=xlsx", {
  token: admin2,
})
assert(xlsx.status === 200, "p2 export xlsx", xlsx)
const pdf = await req("GET", "/reports/export?type=payments&format=pdf", {
  token: admin2,
})
assert(pdf.status === 200, "p2 export pdf", pdf)
assert(String(pdf.text).startsWith("%PDF"), "pdf header", pdf)

const platform = await req("GET", "/admin/audit-logs?action=sale", { token: sa })
assert(platform.status === 200, "admin audit", platform)
assert(platform.json.data.length >= 1, "platform sees sales", platform)

await sequelize.close()
console.log("PHASE11_E2E_OK")
