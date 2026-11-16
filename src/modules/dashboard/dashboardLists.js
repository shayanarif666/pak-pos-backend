/**
 * The short lists the dashboard tables read (GET /<resource>/lists) and the detail pages it opens
 * (GET /<resource>/:id). A list carries only the table's columns; it reads the same rows, filters and paging as
 * the full list of the endpoint documentation (GET /<resource>), so a row of one is a row of the other.
 */
import { Op } from "sequelize"
import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import * as posHistory from "../pos/posHistory.service.js"
import { num, posCategories } from "../pos/posResponses.js"
import { Location } from "../locations/location.model.js"
import { User } from "../auth/user.model.js"
import { PosDevice } from "../pos/posDevice.model.js"
import { Store } from "../stores/store.model.js"
import { Plan } from "../plans/plan.model.js"
import { Category } from "../catalog/category.model.js"
import { listOrderDiscounts } from "../discounts/orderDiscount.service.js"
import { listBulks } from "../discounts/bulkDiscount.service.js"
import { listBundles } from "../discounts/bundleDiscount.service.js"
import { posBulks, posBundles, posOrderDiscount } from "../discounts/discountResponses.js"
import { listCategories } from "../catalog/category.service.js"

const send = (res, { rows, pagination }) => posHistory.sendPage(res, { rows, pagination })
const map = (page, fn) => ({ ...page, rows: page.rows.map(fn) })
const statusOf = (active) => (active === false ? "inactive" : "active")

// ---- Orders: Order #, Date, Cashier, Total Items, Total Amount, Status
export const orderLists = asyncHandler(async (req, res) =>
  send(
    res,
    map(await posHistory.orders(req), (order) => ({
      id: order.id,
      placed_at: order.placed_at,
      staff: order.staff,
      total_items: order.summary.total_items,
      total_amount: order.summary.total_amount,
      currency: order.summary.currency,
      order_status: order.order_status,
      payment_status: order.payment_status,
    }))
  )
)

// ---- Transactions: Transaction #, Order #, Date, Method, Amount, Status
export const transactionLists = asyncHandler(async (req, res) =>
  send(
    res,
    map(await posHistory.transactions(req), (row) => ({
      id: row.id,
      order: row.order,
      paid_at: row.paid_at,
      method: row.method,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
    }))
  )
)

export const transactionOne = asyncHandler(async (req, res) => apiResponse(res, 200, "OK", await posHistory.transactionDetail(req, req.params.id)))

// ---- Products: Product #, Title, SKU, Barcode, Total Variants, Status
const productListRow = (product) => ({
  id: product.id,
  title: product.title,
  sku: product.sku,
  barcode: product.barcode,
  category: product.category ?? null,
  total_variants: Array.isArray(product.variants) ? product.variants.length : 0,
  is_active: product.is_active !== false,
  status: statusOf(product.is_active),
})

export const productLists = asyncHandler(async (req, res) => send(res, map(await posHistory.products(req), productListRow)))

// ---- Weighted products: Product (title), Category (name), Price (unit), Cost (unit)
export const weightedLists = asyncHandler(async (req, res) =>
  send(
    res,
    map(await posHistory.weightList(req), (row) => ({
      id: row.id,
      title: row.title,
      variant: row.variant,
      sku: row.sku,
      category: row.category,
      unit: row.unit,
      price: row.price,
      cost_price: row.cost_price,
      status: row.status,
    }))
  )
)

// ---- Categories: Category #, Name, Sold At, Active
async function soldAtOf(storeId, categories) {
  const numbers = [...new Set(categories.flatMap((row) => row.location_ids || []))]
  const found = numbers.length ? await Location.findAll({ where: { store_id: storeId, location_id_int: { [Op.in]: numbers } }, attributes: ["location_id_int", "name"] }) : []
  const names = new Map(found.map((row) => [row.location_id_int, row.name]))
  return (row) =>
    row.location_scope === "selected"
      ? { scope: "selected", locations: (row.location_ids || []).map((id) => ({ id, name: names.get(id) || null })) }
      : { scope: "all", locations: [] }
}

const categoryListRow = (soldAt) => (row) => ({
  id: row.id,
  name: row.name,
  sold_at: soldAt(row),
  is_active: row.is_active !== false,
  status: statusOf(row.is_active),
})

export const categoryLists = asyncHandler(async (req, res) => {
  const page = await posHistory.categories(req)
  const scope = await posHistory.scopeOf(req)
  return send(res, map(page, categoryListRow(await soldAtOf(scope.store_id, page.rows))))
})

/** GET /categories/:id — the category (as GET /categories gives it), where it is sold, and its products (the /products/lists columns). */
export const categoryOne = asyncHandler(async (req, res) => {
  const scope = await posHistory.scopeOf(req)
  const ref = String(req.params.id)
  const where = /^\d+$/.test(ref) ? { store_id: scope.store_id, category_number: Number(ref) } : { store_id: scope.store_id, id: ref }
  const row = await Category.findOne({ where, attributes: ["id", "category_number"] })
  if (!row) throw new NotFoundError("Category not found")
  const listed = (await listCategories(scope.store_id, scope, { location_id: scope.location_id })).find((entry) => entry.id === row.id)
  if (!listed) throw new NotFoundError("Category not found")
  const [category] = await posCategories([listed])
  const products = await posHistory.products({ ...req, query: { ...req.query, categories: String(row.category_number) } })
  return res.status(200).json({
    success: true,
    message: "OK",
    data: { ...category, sold_at: (await soldAtOf(scope.store_id, [category]))(category), products: products.rows.map(productListRow) },
    pagination: products.pagination,
  })
})

// ---- Discounts: the order discounts, the bulk discounts and the bundle discounts together
export const discountLists = asyncHandler(async (req, res) => {
  const query = { active: req.query.active }
  const [discounts, bulks, bundles] = await Promise.all([listOrderDiscounts(req.storeId, query), listBulks(req.storeId, query), listBundles(req.storeId, query)])
  return apiResponse(res, 200, "OK", {
    discounts: discounts.map(posOrderDiscount),
    bulk_discounts: await posBulks(bulks),
    bundle_discounts: await posBundles(bundles),
  })
})

// ---- Locations: Location #, Name, City, Manager Info, Status
async function locationsWithStaff(storeId, scope, where = {}) {
  const locations = await Location.findAll({
    where: { store_id: storeId, deleted_at: null, ...(scope.role !== "store_admin" ? { id: scope.location_id || null } : {}), ...where },
    order: [["location_id_int", "ASC"]],
  })
  const staff = locations.length
    ? await User.findAll({
        where: { store_id: storeId, location_id: { [Op.in]: locations.map((row) => row.id) }, role: { [Op.in]: ["manager", "cashier"] }, deleted_at: null },
        order: [["role", "ASC"], ["user_number", "ASC"]],
      })
    : []
  return locations.map((location) => ({ location, users: staff.filter((user) => user.location_id === location.id) }))
}

const userView = (user, { pin }) => ({
  id: user.user_number,
  name: user.name,
  email: user.email,
  phone: user.phone || null,
  role: user.role,
  ...(pin ? { pin: user.pin || null } : {}),
  is_active: Boolean(user.is_active),
})

export const locationLists = asyncHandler(async (req, res) => {
  const scope = await posHistory.scopeOf(req)
  const { page, limit, offset } = posHistory.pageOf(req.query)
  const all = await locationsWithStaff(scope.store_id, { ...scope, location_id: req.auth?.location_id || req.user.location_id })
  const rows = all.slice(offset, offset + limit).map(({ location, users }) => {
    const manager = users.find((user) => user.role === "manager")
    return {
      id: location.location_id_int,
      name: location.name,
      city: location.city || null,
      manager: manager ? { id: manager.user_number, name: manager.name, email: manager.email, phone: manager.phone || null } : null,
      is_active: Boolean(location.is_active),
      status: statusOf(location.is_active),
    }
  })
  return send(res, { rows, pagination: { page, limit, total: all.length, total_pages: Math.max(1, Math.ceil(all.length / limit)) } })
})

/** GET /locations/:id — the location with everything: address, contact, its manager and cashiers (the PIN only for a store admin). */
export const locationOne = asyncHandler(async (req, res) => {
  const scope = await posHistory.scopeOf(req)
  const ref = String(req.params.id)
  const where = /^\d+$/.test(ref) ? { location_id_int: Number(ref) } : { id: ref }
  const [found] = await locationsWithStaff(scope.store_id, { ...scope, location_id: req.auth?.location_id || req.user.location_id }, where)
  if (!found) throw new NotFoundError("Location not found")
  const { location, users } = found
  const pin = scope.role === "store_admin"
  const manager = users.find((user) => user.role === "manager")
  return apiResponse(res, 200, "OK", {
    id: location.location_id_int,
    name: location.name,
    address: location.address_line || null,
    city: location.city || null,
    country: location.country || null,
    postal_code: location.postal_code || null,
    phone: location.phone || null,
    is_default: Boolean(location.is_default),
    is_active: Boolean(location.is_active),
    status: statusOf(location.is_active),
    manager: manager ? userView(manager, { pin }) : null,
    users: users.map((user) => userView(user, { pin })),
    created_at: location.created_at,
    updated_at: location.updated_at,
  })
})

// ---- Devices: Device #, Device Id, Location (name), Status
export const deviceLists = asyncHandler(async (req, res) => {
  const scope = await posHistory.scopeOf(req)
  const { page, limit, offset } = posHistory.pageOf(req.query)
  const where = { store_id: scope.store_id, ...(scope.location_id ? { location_id: scope.location_id } : {}) }
  const { rows, count } = await PosDevice.findAndCountAll({ where, include: [{ model: Location, attributes: ["location_id_int", "name"] }], order: [["device_number", "ASC"]], limit, offset })
  return send(res, {
    rows: rows.map((row) => ({
      id: row.device_number,
      device_id: row.device_uid,
      name: row.name,
      location: row.Location ? { id: row.Location.location_id_int, name: row.Location.name } : null,
      platform: row.platform || null,
      app_version: row.app_version || null,
      last_seen_at: row.last_seen_at,
      is_active: Boolean(row.is_active),
      status: statusOf(row.is_active),
    })),
    pagination: { page, limit, total: count, total_pages: Math.max(1, Math.ceil(count / limit)) },
  })
})

// ---- Store information (store admin only)
export const storeDetail = asyncHandler(async (req, res) => {
  if (req.user.role !== "store_admin") throw new ForbiddenError("Only the store admin can see the store information")
  const store = await Store.findByPk(req.storeId, { include: [{ model: Plan, attributes: ["name", "code", "reporting_level", "max_devices", "max_locations"] }] })
  if (!store) throw new NotFoundError("Store not found")
  const location = store.default_location_id ? await Location.findByPk(store.default_location_id, { attributes: ["location_id_int", "name"] }) : null
  const [locations, devices, staff] = await Promise.all([
    Location.count({ where: { store_id: store.id, deleted_at: null } }),
    PosDevice.count({ where: { store_id: store.id } }),
    User.count({ where: { store_id: store.id, deleted_at: null, role: { [Op.in]: ["store_admin", "manager", "cashier"] } } }),
  ])
  return apiResponse(res, 200, "OK", {
    id: store.store_id_int,
    name: store.name,
    legal_name: store.legal_name || null,
    owner_name: store.owner_name || null,
    business_type: store.business_type,
    address: store.address,
    city: store.city || null,
    contact_email: store.contact_email,
    contact_phone: store.contact_phone,
    logo_url: store.logo_url || null,
    currency: store.currency,
    timezone: store.timezone,
    ntn: store.ntn || null,
    strn: store.strn || null,
    fbr_invoice_enabled: Boolean(store.fbr_invoice_enabled),
    expiry_warning_days: store.expiry_warning_days,
    expiry_critical_days: store.expiry_critical_days,
    receipt_footer: store.receipt_footer || null,
    default_location: location ? { id: location.location_id_int, name: location.name } : null,
    plan: store.Plan ? { name: store.Plan.name, code: store.Plan.code, reporting_level: store.Plan.reporting_level, max_devices: store.Plan.max_devices, max_locations: store.Plan.max_locations } : null,
    account_manager: store.account_manager_name ? { name: store.account_manager_name, phone: store.account_manager_phone || null } : null,
    counts: { locations, devices, staff },
    status: store.status,
    is_active: Boolean(store.is_active),
    trial_ends_at: store.trial_ends_at,
    created_at: store.created_at,
  })
})

export { num }
