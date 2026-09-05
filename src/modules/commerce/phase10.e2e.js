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

await sequelize.authenticate()

const sa = await login(env.SUPERADMIN_EMAIL, env.SUPERADMIN_PASSWORD)
const plans = await req("GET", "/plans", { token: sa })
const p1 = plans.json.data.find((p) => p.code === "package_1")

const slug = "p10-" + stamp
const reg = await req("POST", "/admin/stores", {
  token: sa,
  body: {
    plan_id: p1.id,
    name: "Phase10 " + stamp,
    slug,
    business_type: "grocery",
    address: "1 Web Street",
    city: "Lahore",
    contact_email: "p10-" + stamp + "@web.local",
    contact_phone: "+923001111111",
    location_name: "Warehouse",
    admin_name: "Admin",
    admin_email: "admin-p10-" + stamp + "@web.local",
    admin_password: "secret12",
    admin_pin: "1111",
    manager_name: "Mgr",
    manager_email: "mgr-p10-" + stamp + "@web.local",
    manager_password: "secret12",
    manager_pin: "2222",
    billing_status: "paid",
    amount: 0,
  },
})
assert(reg.status === 201, "register store", reg)
const storeId = reg.json.data.store.id
const locId = reg.json.data.location.id

const live = await req("PATCH", "/admin/stores/" + storeId, {
  token: sa,
  body: { is_live: true, web_enabled: true },
})
assert(live.status === 200, "store live", live)

const admin = await login("admin-p10-" + stamp + "@web.local", "secret12")
const shipping = await req("PUT", "/stores/me/shipping", {
  token: admin,
  body: { flat_fee: 40, free_over_amount: 500 },
})
assert(shipping.status === 200, "shipping", shipping)

const cat = await req("POST", "/categories", {
  token: admin,
  body: { name: "Pantry" },
})
const product = await req("POST", "/products", {
  token: admin,
  body: {
    title: "Honey",
    sku: "HONEY-P10-" + stamp,
    category_id: cat.json.data.id,
    cost_price: 180,
    selling_price: 300,
    is_published: true,
    web_visible: true,
  },
})
assert(product.status === 201, "product", product)
const productId = product.json.data.id
await req("PUT", "/product-stocks/" + productId, {
  token: admin,
  body: { location_id: locId, qty: 10, reason: "opening_balance" },
})

const theme = await req("GET", "/public/stores/" + slug + "/theme")
assert(theme.status === 200, "public theme", theme)
const pubShip = await req("GET", "/public/stores/" + slug + "/shipping")
assert(Number(pubShip.json.data.flat_fee) === 40, "public shipping", pubShip)
const pubProduct = await req("GET", "/public/stores/" + slug + "/products/" + productId)
assert(pubProduct.status === 200, "public product", pubProduct)

const registered = await req("POST", "/auth/register-customer", {
  body: {
    store_slug: slug,
    name: "Ali Web",
    email: "ali-p10-" + stamp + "@web.local",
    password: "secret12",
    phone: "+923001112222",
  },
})
assert(registered.status === 201 || registered.status === 200, "register customer", registered)
const custTok =
  registered.json.data.access_token ||
  (await login("ali-p10-" + stamp + "@web.local", "secret12", { store_slug: slug }))

const staffCart = await req("POST", "/cart/items", {
  token: admin,
  body: { product_id: productId, quantity: 1 },
})
assert(staffCart.status === 403, "staff cannot use cart", staffCart)

const added = await req("POST", "/cart/items", {
  token: custTok,
  body: { product_id: productId, quantity: 1 },
})
assert(added.status === 201, "add cart", added)
assert(added.json.data.items.length === 1, "one line", added)
assert(Number(added.json.data.quote.shipping_fee) === 40, "paid shipping", added)

const address = await req("POST", "/addresses", {
  token: custTok,
  body: {
    name: "Ali Web",
    phone: "+923001112222",
    address_line: "12 Canal Road",
    city: "Lahore",
    postal_code: "54000",
    is_default: true,
  },
})
assert(address.status === 201, "address", address)

const noSessionSale = await req("POST", "/orders", {
  token: custTok,
  body: {
    channel: "web",
    address_id: address.json.data.id,
    payment_method: "cod",
  },
})
assert(noSessionSale.status === 201, "web checkout", noSessionSale)
assert(noSessionSale.json.data.order.channel === "web", "channel web", noSessionSale)
assert(noSessionSale.json.data.order.register_session_id == null, "no register", noSessionSale)
assert(Number(noSessionSale.json.data.order.shipping_fee) === 40, "ship 40", noSessionSale)
assert(Number(noSessionSale.json.data.order.total_amount) === 340, "total 340", noSessionSale)
assert(noSessionSale.json.data.order.customer_id, "customer linked", noSessionSale)
assert(
  String(noSessionSale.json.data.order.shipping_address).includes("Canal Road"),
  "address snapshot",
  noSessionSale
)

const emptyCart = await req("GET", "/cart", { token: custTok })
assert(emptyCart.json.data.items.length === 0, "cart cleared", emptyCart)

const stocks = await req("GET", "/product-stocks?location_id=" + locId, { token: admin })
const afterFirst = stocks.json.data.find((s) => s.product_id === productId)
assert(Number(afterFirst.qty) === 9, "stock after web sale", afterFirst)

const added2 = await req("POST", "/cart/items", {
  token: custTok,
  body: { product_id: productId, quantity: 2 },
})
assert(Number(added2.json.data.quote.shipping_fee) === 0, "free shipping quote", added2)

const freeShip = await req("POST", "/orders", {
  token: custTok,
  body: {
    channel: "web",
    address_id: address.json.data.id,
    payment_method: "cod",
  },
})
assert(freeShip.status === 201, "free ship order", freeShip)
assert(Number(freeShip.json.data.order.shipping_fee) === 0, "ship 0", freeShip)
assert(Number(freeShip.json.data.order.total_amount) === 600, "total 600", freeShip)

const mine = await req("GET", "/orders", { token: custTok })
assert(mine.status === 200, "my orders", mine)
assert(mine.json.data.length === 2, "two own orders", mine)

const other = await req("POST", "/auth/register-customer", {
  body: {
    store_slug: slug,
    name: "Other Web",
    email: "other-p10-" + stamp + "@web.local",
    password: "secret12",
  },
})
assert(other.status === 201 || other.status === 200, "second customer", other)
const otherTok =
  other.json.data.access_token ||
  (await login("other-p10-" + stamp + "@web.local", "secret12", { store_slug: slug }))

const otherList = await req("GET", "/orders", { token: otherTok })
assert(otherList.json.data.length === 0, "other sees none", otherList)

const stolen = await req("GET", "/orders/" + noSessionSale.json.data.order.id, {
  token: otherTok,
})
assert(stolen.status === 404, "cannot read others order", stolen)

const pendingReview = await req("POST", "/reviews", {
  token: custTok,
  body: { product_id: productId, rating: 5, comment: "Great honey" },
})
assert(pendingReview.status === 201, "review pending", pendingReview)
assert(pendingReview.json.data.status === "pending", "status pending", pendingReview)

const hidden = await req("GET", "/public/stores/" + slug + "/products/" + productId + "/reviews")
assert(hidden.status === 200, "public reviews", hidden)
assert(hidden.json.data.length === 0, "pending hidden", hidden)

const queue = await req("GET", "/reviews", { token: admin })
assert(queue.json.data.some((r) => r.id === pendingReview.json.data.id), "moderation list", queue)

const approved = await req("PATCH", "/reviews/" + pendingReview.json.data.id, {
  token: admin,
  body: { status: "approved" },
})
assert(approved.status === 200, "approve", approved)

const visible = await req("GET", "/public/stores/" + slug + "/products/" + productId + "/reviews")
assert(visible.json.data.length === 1, "approved visible", visible)
assert(visible.json.data[0].rating === 5, "rating", visible)

await sequelize.close()
console.log("PHASE10_E2E_OK")
