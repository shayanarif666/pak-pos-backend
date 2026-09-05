import { env } from "../../config/env.js"
import { registerModels } from "../../db/registerModels.js"
import { sequelize } from "../../db/sequelize.js"
import { User } from "../auth/user.model.js"
import { ProductStock } from "../catalog/productStock.model.js"
import { StockMovement } from "../inventory/stockMovement.model.js"
import { registerStore } from "../admin/admin.service.js"
import { createCategory } from "../catalog/category.service.js"
import { createProduct } from "../catalog/product.service.js"
import { putStock } from "../catalog/productStock.service.js"
import { getStoreForManager, upsertShipping } from "../stores/store.service.js"
import { Plan } from "../plans/plan.model.js"
import { createOrder } from "./createOrder.service.js"
import { money } from "./pricing.service.js"
import { clockIn } from "../pos/registerSession.service.js"

registerModels()

function assert(cond, msg, extra) {
  if (!cond) {
    console.error("FAIL", msg, extra === undefined ? "" : extra)
    process.exit(1)
  }
}

const stamp = Date.now()

await sequelize.authenticate()

const superadmin = await User.findOne({
  where: { email: env.SUPERADMIN_EMAIL, role: "superadmin" },
})
assert(superadmin, "superadmin missing — run db:seed:superadmin")

const plan = await Plan.findOne({ where: { code: "package_2" } })
const onboarded = await registerStore(
  {
    plan_id: plan.id,
    name: "Phase8 " + stamp,
    slug: "p8-" + stamp,
    business_type: "grocery",
    address: "1 Test Street",
    city: "Lahore",
    contact_email: "p8-" + stamp + "@local",
    contact_phone: "+923001111111",
    location_name: "Main Counter",
    admin_name: "Admin",
    admin_email: "admin-p8-" + stamp + "@local",
    admin_password: "secret12",
    admin_pin: "1111",
    manager_name: "Mgr",
    manager_email: "mgr-p8-" + stamp + "@local",
    manager_password: "secret12",
    manager_pin: "2222",
    billing_status: "paid",
    amount: 0,
  },
  superadmin
)

const store = await getStoreForManager(onboarded.store.id)
await upsertShipping(store, { flat_fee: 40, free_over_amount: null })

const actor = {
  id: onboarded.admin.id,
  store_id: store.id,
  store_id_int: store.store_id_int,
  role: "store_admin",
  location_id: onboarded.location.id,
}
await clockIn(
  {
    id: onboarded.manager.id,
    store_id: store.id,
    role: "manager",
    location_id: onboarded.location.id,
  },
  { opening_cash: 1000, location_id: onboarded.location.id }
)

const category = await createCategory(store, { name: "Grocery" })
const product = await createProduct(store, {
  title: "Rice 5kg",
  sku: "RICE-" + stamp,
  category_id: category.id,
  cost_price: 400,
  selling_price: 500,
})
await putStock(actor, product.id, {
  location_id: onboarded.location.id,
  qty: 20,
  reason: "opening_balance",
})

const basket = [{ product_id: product.id, quantity: 2 }]
const clientId = "offline-" + stamp

const pos = await createOrder(actor, {
  channel: "pos",
  location_id: onboarded.location.id,
  items: basket,
  payment_method: "cash",
  client_local_id: clientId,
  total_amount: 1,
})
assert(pos.idempotent === false, "first sale is new")
assert(Number(pos.order.shipping_fee) === 0, "POS shipping 0", pos.order)
assert(Number(pos.order.total_amount) === 1000, "POS total 2x500", pos.order)
assert(Number(pos.order.cost_total) === 800, "cost snapshot", pos.order)
assert(pos.items.length === 1, "one line")
assert(pos.payments.length === 1, "one payment")
assert(pos.receipt, "receipt created")

const replay = await createOrder(actor, {
  channel: "pos",
  location_id: onboarded.location.id,
  items: basket,
  payment_method: "cash",
  client_local_id: clientId,
  total_amount: 1,
})
assert(replay.idempotent === true, "retry is idempotent")
assert(replay.order.id === pos.order.id, "same order")

const web = await createOrder(actor, {
  channel: "web",
  location_id: onboarded.location.id,
  items: basket,
  payment_method: "cash",
  shipping_address: "House 1, Lahore",
  total_amount: 99999,
})
assert(Number(web.order.shipping_fee) === 40, "web shipping", web.order)
assert(Number(web.order.subtotal) === Number(pos.order.subtotal), "same subtotal")
assert(
  Number(web.order.total_amount) === money(Number(pos.order.total_amount) + 40),
  "web = pos + shipping",
  { web: web.order, pos: pos.order }
)
assert(Number(web.order.total_amount) !== 99999, "client total ignored")

const stock = await ProductStock.findOne({
  where: { product_id: product.id, location_id: onboarded.location.id },
})
assert(Number(stock.qty) === 16, "20 - 2 - 2, retry did not deduct", stock)

const sales = await StockMovement.findAll({
  where: { product_id: product.id, movement_type: "sale" },
})
assert(sales.length === 2, "two sale movements, not three", sales.length)

const custom = await createOrder(actor, {
  channel: "pos",
  is_custom: true,
  items: [{ title: "Loose bag", quantity: 1, unit_price: 75 }],
  payment_method: "cash",
})
assert(custom.order.is_custom === true, "custom flag")
assert(Number(custom.order.total_amount) === 75, "custom total", custom.order)
const stockAfterCustom = await ProductStock.findOne({
  where: { product_id: product.id, location_id: onboarded.location.id },
})
assert(Number(stockAfterCustom.qty) === 16, "custom sale skips stock")

await sequelize.close()
console.log("PHASE8_E2E_OK")
