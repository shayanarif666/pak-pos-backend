import { PAYMENT_METHOD, STOCK_MOVEMENT_REASON, STOCK_MOVEMENT_TYPE } from "../../db/enums.js"
import { AppError } from "../../shared/errors/AppError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { User } from "../auth/user.model.js"
import { Category } from "../catalog/category.model.js"
import { Product } from "../catalog/product.model.js"
import { Supplier } from "../inventory/supplier.model.js"
import { RegisterSession } from "../pos/registerSession.model.js"

/*
 * The filters of GET /api/v1/reporting/:section, one list per section (the POS shows ten of the
 * sections, the dashboard all of them — they are the same endpoint, so the same filters).
 *
 * A filter a section does not declare is ignored, never an error; a value that does not fit
 * (an unknown enum value, a bad number) is a 400. The dashboard builds its filter bar from
 * GET /reporting (every card carries its `filters`), so a new filter appears there by itself.
 */

export const PAYMENT_METHODS = PAYMENT_METHOD.filter((method) => method !== "mixed")
const KINDS = ["pack", "loose", "weight"]
const LOSS_REASONS = ["damage", "theft", "expiry", "waste"]

const choice = (label, values, def = null) => ({ type: "enum", label, values, default: def })
const flag = (label, def = null) => ({ type: "boolean", label, default: def })
const text = (label) => ({ type: "text", label })
const number = (label) => ({ type: "number", label })
// kind: which list the dashboard offers (staff / category / supplier / product / batch / variant).
const pick = (kind, label) => ({ type: "ref", kind, label })

const STAFF = pick("staff", "Cashier")
const CATEGORY = pick("category", "Category")
const SUPPLIER = pick("supplier", "Supplier")

export const SECTION_FILTERS = {
  // ---- the POS sections
  sales: {
    payment_method: choice("Payment method", PAYMENT_METHODS),
    order_status: choice("Order status", ["completed", "partial_refunded"]),
    discounted: flag("Only discounted orders"),
    custom: flag("Only custom sales"),
  },
  top_products: {
    type: choice("Type", KINDS),
    zero_sales: flag("Products that did not sell"),
  },
  top_categories: {
    category_id: CATEGORY,
    sort: choice("Sort by", ["revenue", "profit"], "revenue"),
    net_of_refunds: flag("Take refunds off", true),
  },
  payments: {
    method: choice("Payment method", PAYMENT_METHODS),
    payment_type: choice("Payment type", ["single", "split"]),
  },
  batches: {
    status: choice("Batch status", ["open", "closed", "all"], "all"),
    variance_only: flag("Only batches with a variance"),
    staff_id: STAFF,
  },
  inventory: {
    stock_status: choice("Stock", ["low", "out", "ok"]),
    expiry_status: choice("Expiry", ["expired", "critical", "warning"]),
    type: choice("Type", KINDS),
    supplier_id: SUPPLIER,
  },
  movements: {
    movement_type: choice("Movement type", STOCK_MOVEMENT_TYPE),
    reason: choice("Reason", STOCK_MOVEMENT_REASON),
    product_id: pick("product", "Product"),
    variant_id: pick("variant", "Variant"),
    supplier_id: SUPPLIER,
    staff_id: pick("staff", "Staff"),
  },
  refunds_cancelled: {
    type: choice("Type", ["partial_refund", "complete_refund", "cancelled", "voided"]),
    reason: text("Reason contains"),
    staff_id: STAFF,
    refund_method: choice("Refunded by", [...PAYMENT_METHODS, "credit"]),
  },
  cashiers: {
    staff_id: STAFF,
    batch_id: pick("batch", "Batch"),
    sort: choice("Sort by", ["sales", "refunds", "discount"], "sales"),
  },
  tax: {
    tax_name: text("Tax name"),
    level: choice("Level", ["product", "store", "category"]),
    tax_type: choice("Type", ["percentage", "fixed"]),
  },

  // ---- dashboard-only sections
  locations: { sort: choice("Sort by", ["sales", "orders", "refunds"], "sales") },
  transfers: {
    status: choice("Status", ["on_the_way", "completed", "cancelled"]),
    product_id: pick("product", "Product"),
  },
  discounts: { staff_id: STAFF },
  sessions: {
    staff_id: pick("staff", "Staff"),
    status: choice("Status", ["on_duty", "clocked_out"]),
  },
  profit: {
    category_id: CATEGORY,
    sort: choice("Sort by", ["profit", "margin", "sales"], "profit"),
  },
  offers: { staff_id: STAFF },
  dead_stock: {
    category_id: CATEGORY,
    min_days: number("Not sold for at least (days)"),
  },
  forecast: {
    status: choice("Stock left", ["out", "critical", "low", "ok", "no_sales"]),
    category_id: CATEGORY,
  },
  peak_hours: {
    staff_id: STAFF,
    payment_method: choice("Payment method", PAYMENT_METHODS),
  },
  customers: {
    has_udhaar: flag("Owing udhaar"),
    sort: choice("Sort by", ["spent", "udhaar", "orders"], "spent"),
  },
  suppliers: { supplier_id: SUPPLIER },
  variance: {
    staff_id: STAFF,
    reason: choice("Loss reason", LOSS_REASONS),
  },
}

/** A section's filters as the dashboard needs them: [{ name, label, type, kind?, values?, default? }]. */
export function filterSpecFor(section) {
  return Object.entries(SECTION_FILTERS[section] || {}).map(([name, def]) => ({
    name,
    label: def.label,
    type: def.type,
    ...(def.kind ? { kind: def.kind } : {}),
    ...(def.values ? { values: def.values } : {}),
    ...(def.default != null ? { default: def.default } : {}),
  }))
}

/** The query values of a section's filters, checked. Not sent / empty = left out of the result. */
export function parseFilters(section, query = {}) {
  const out = {}
  for (const [name, def] of Object.entries(SECTION_FILTERS[section] || {})) {
    const raw = query[name]
    if (raw === undefined || raw === null) continue
    const value = String(raw).trim()
    if (!value) continue
    if (def.type === "enum") {
      const lower = value.toLowerCase()
      if (!def.values.includes(lower)) throw new AppError(`${name} must be one of: ${def.values.join(", ")}`, 400)
      out[name] = lower
    } else if (def.type === "boolean") {
      const lower = value.toLowerCase()
      if (["true", "1", "yes"].includes(lower)) out[name] = true
      else if (["false", "0", "no"].includes(lower)) out[name] = false
      else throw new AppError(`${name} must be true or false`, 400)
    } else if (def.type === "number") {
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0) throw new AppError(`${name} must be a number of 0 or more`, 400)
      out[name] = n
    } else {
      out[name] = value.slice(0, 100)
    }
  }
  return out
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REF_MODEL = {
  staff: [User, "user_number", "Staff member"],
  category: [Category, "category_number", "Category"],
  supplier: [Supplier, "supplier_number", "Supplier"],
  batch: [RegisterSession, "session_number", "Batch"],
}

/** A row of the store by its short number or UUID → its UUID (404 when it is not this store's). */
async function idOf(kind, storeId, ref) {
  const [model, column, label] = REF_MODEL[kind]
  const where = /^\d+$/.test(ref) ? { store_id: storeId, [column]: Number(ref) } : UUID.test(ref) ? { store_id: storeId, id: ref } : null
  if (!where) throw new AppError(`${label} must be its number or UUID`, 400)
  const row = await model.findOne({ where, attributes: ["id"] })
  if (!row) throw new NotFoundError(`${label} not found`)
  return row.id
}

/** product_id (+ variant_id): the product rows to look at — a variant, or the product and all its variants. */
async function productIdsOf(storeId, productRef, variantRef) {
  const where = /^\d+$/.test(productRef) ? { store_id: storeId, product_number: Number(productRef) } : UUID.test(productRef) ? { store_id: storeId, id: productRef } : null
  if (!where) throw new AppError("Product must be its number or UUID", 400)
  const product = await Product.findOne({ where, attributes: ["id", "has_variants"] })
  if (!product) throw new NotFoundError("Product not found")
  if (variantRef) {
    const variantWhere = /^\d+$/.test(variantRef) ? { parent_product_id: product.id, variant_number: Number(variantRef) } : { parent_product_id: product.id, id: variantRef }
    const variant = await Product.findOne({ where: { store_id: storeId, ...variantWhere }, attributes: ["id"] })
    if (!variant) throw new NotFoundError("Variant not found")
    return [variant.id]
  }
  if (!product.has_variants) return [product.id]
  const variants = await Product.findAll({ where: { store_id: storeId, parent_product_id: product.id }, attributes: ["id"] })
  return [product.id, ...variants.map((row) => row.id)]
}

/** The filters with every reference (staff, category, supplier, batch, product) turned into UUIDs. */
export async function resolveFilters(storeId, section, filters) {
  const defs = SECTION_FILTERS[section] || {}
  const out = { ...filters }
  for (const [name, value] of Object.entries(filters)) {
    const def = defs[name]
    if (def?.type === "ref" && REF_MODEL[def.kind]) out[name] = await idOf(def.kind, storeId, value)
  }
  if (filters.product_id) out.product_ids = await productIdsOf(storeId, filters.product_id, filters.variant_id)
  return out
}

/** weight = sold by weight; else pack = a pack product; else loose. */
export const productKind = (product) => (!product ? null : product.is_weight_based ? "weight" : product.is_pack_product ? "pack" : "loose")

// ---- orders (sales, payments, cashiers, tax, discounts, offers, peak hours…)

/** The payment methods an order was paid with (a split bill has several). */
function methodsOf(order) {
  const paid = (order.Payments || []).filter((row) => !row.status || row.status === "success").map((row) => row.method)
  const methods = [...new Set(paid)]
  if (methods.length) return methods
  return order.payment_method && order.payment_method !== "mixed" ? [order.payment_method] : []
}
const isCustomOrder = (order) => Boolean(order.is_custom) || (order.OrderItems || []).some((item) => !item.product_id)
const hasDiscount = (order) =>
  Number(order.line_discount_amount || 0) > 0 || Number(order.discount_amount || 0) > 0 || Number(order.coupon_discount_amount || 0) > 0

/** Only the orders that fit the order-level filters (cashier, batch, status, discounted, custom, payment). */
export function filterOrders(orders, f) {
  if (!["staff_id", "batch_id", "order_status", "discounted", "custom", "payment_method", "payment_type"].some((name) => f[name] !== undefined)) return orders
  return orders.filter((order) => {
    if (f.staff_id && order.cashier_id !== f.staff_id) return false
    if (f.batch_id && order.register_session_id !== f.batch_id) return false
    if (f.order_status && order.order_status !== f.order_status) return false
    if (f.custom !== undefined && isCustomOrder(order) !== f.custom) return false
    if (f.discounted !== undefined && hasDiscount(order) !== f.discounted) return false
    if (f.payment_method && !methodsOf(order).includes(f.payment_method)) return false
    if (f.payment_type && (methodsOf(order).length > 1) !== (f.payment_type === "split")) return false
    return true
  })
}

/** Only the sold lines that pass `keep(item)`; an order left without lines drops out. */
export function filterLines(completed, keep) {
  return completed
    .map((entry) => ({ ...entry, figures: { ...entry.figures, lines: entry.figures.lines.filter((line) => keep(line.item)) } }))
    .filter((entry) => entry.figures.lines.length)
}

/** The line filters of a section (product type, category) as one test, or null when there are none. */
export function lineTest(f) {
  if (!f.type && !f.category_id) return null
  return (item) => {
    if (f.type && productKind(item.Product) !== f.type) return false
    if (f.category_id && (item.Product?.category_id || item.category_id) !== f.category_id) return false
    return true
  }
}
