import { Op } from "sequelize"
import { Category } from "./category.model.js"
import { Product } from "./product.model.js"
import { ProductStock } from "./productStock.model.js"
import { lotsByStock } from "./stockLots.service.js"
import { Location } from "../locations/location.model.js"
import { AppError } from "../../shared/errors/AppError.js"

/*
 * GET /products/stock: the stock of every product (or variant) at every location, with its lots.
 * One row = a product / variant at a location; its lots (the stock that came in together, each with
 * its own expiry date) are inside it, soonest expiry first. Thresholds are fixed:
 *   expiry_status of a lot: expired (past) | critical (0-7 days left) | warning (8-30) | ok | none (no expiry date)
 *   stock_status of a row:  out (0) | critical (half of low_stock_threshold or less) | warning (up to the threshold) | ok
 */

export const EXPIRY_CRITICAL_DAYS = 7
export const EXPIRY_WARNING_DAYS = 30
export const STOCK_STATUSES = ["ok", "warning", "critical", "out"]
export const LOT_EXPIRY_STATUSES = ["ok", "warning", "critical", "expired", "none"]

const round4 = (value) => Math.round((Number(value) + Number.EPSILON) * 10000) / 10000

/** Days from today to a date (negative once it is past); null without a date. */
export function daysToExpiry(date, now = new Date()) {
  if (!date) return null
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  return Math.round((new Date(`${String(date).slice(0, 10)}T00:00:00`) - today) / 86400000)
}

export function lotExpiryStatus(date, now = new Date()) {
  const left = daysToExpiry(date, now)
  if (left == null) return "none"
  if (left < 0) return "expired"
  if (left <= EXPIRY_CRITICAL_DAYS) return "critical"
  if (left <= EXPIRY_WARNING_DAYS) return "warning"
  return "ok"
}

export function stockStatus(qty, threshold) {
  const have = Number(qty)
  if (!(have > 0)) return "out"
  const limit = Number(threshold)
  if (!(limit > 0)) return "ok"
  if (have <= limit / 2) return "critical"
  if (have <= limit) return "warning"
  return "ok"
}

const packsOf = (qty, packSize) => {
  const size = Number(packSize)
  return size >= 2 ? Math.floor(Number(qty) / size) : null
}

const pickEnum = (value, allowed, label) => {
  if (value === undefined || value === null || value === "") return null
  const text = String(value)
  if (!allowed.includes(text)) throw new AppError(`${label} must be ${allowed.join(", ")}`, 400)
  return text
}

/** { rows (every row that matches, in order), total } for the actor's location scope. */
export async function listStockRows(scope, query = {}) {
  const stockFilter = pickEnum(query.stock_status, STOCK_STATUSES, "stock_status")
  const expiryFilter = pickEnum(query.expiry_status, LOT_EXPIRY_STATUSES, "expiry_status")
  const search = String(query.q || "").trim().toLowerCase()

  const where = { store_id: scope.store_id, deleted_at: null }
  if (scope.location_id) where.location_id = scope.location_id

  const productWhere = { deleted_at: null, has_variants: false }
  const categoryRef = String(query.category_id ?? query.categoryId ?? "").trim()
  if (categoryRef) {
    const categoryWhere = { store_id: scope.store_id }
    if (/^\d+$/.test(categoryRef)) categoryWhere.category_number = Number(categoryRef)
    else categoryWhere.id = categoryRef
    const category = await Category.findOne({ where: categoryWhere, attributes: ["id"] })
    // An unknown category matches nothing.
    if (!category) return { rows: [], total: 0 }
    productWhere.category_id = category.id
  }

  const stocks = await ProductStock.findAll({
    where,
    include: [{ model: Product, where: productWhere, include: [{ model: Product, as: "parent", attributes: ["id", "product_number", "title", "sku", "barcode"] }] }],
  })
  if (!stocks.length) return { rows: [], total: 0 }

  const lotMap = await lotsByStock(stocks)
  const locations = new Map(
    (await Location.findAll({ where: { id: { [Op.in]: [...new Set(stocks.map((row) => row.location_id))] } }, attributes: ["id", "location_id_int", "name"] })).map((row) => [row.id, row])
  )
  const now = new Date()

  let rows = stocks.map((stock) => {
    const product = stock.Product
    const parent = product.parent || null
    const location = locations.get(stock.location_id)
    const lots = (lotMap.get(`${stock.location_id}|${stock.product_id}`) || []).map((lot) => ({
      id: lot.lot_number,
      received_at: lot.received_at,
      qty: round4(lot.qty),
      expiry_date: lot.expiry_date || null,
      days_to_expiry: daysToExpiry(lot.expiry_date, now),
      expiry_status: lotExpiryStatus(lot.expiry_date, now),
    }))
    const qty = round4(stock.qty)
    const threshold = stock.low_stock_threshold ?? product.low_stock_threshold
    const dates = lots.map((lot) => lot.expiry_date).filter(Boolean).sort()
    return {
      product: {
        id: parent ? parent.product_number : product.product_number,
        title: parent ? parent.title : product.title,
        unit: product.unit,
        sku: parent ? parent.sku : product.sku,
        barcode: parent ? parent.barcode : product.barcode,
        variant: parent ? { id: product.variant_number, name: product.variant_name, sku: product.sku, barcode: product.barcode } : null,
      },
      location: { id: location?.location_id_int ?? stock.location_id_int, name: location?.name || null },
      qty,
      qty_packs: product.is_pack_product ? packsOf(qty, product.pack_size) : null,
      low_stock_threshold: threshold == null ? null : round4(threshold),
      stock_status: stockStatus(qty, threshold),
      nearest_expiry_date: dates[0] || null,
      lots,
    }
  })

  if (search) {
    rows = rows.filter((row) =>
      [row.product.title, row.product.sku, row.product.barcode, row.product.variant?.name, row.product.variant?.sku, row.product.variant?.barcode]
        .filter(Boolean)
        .some((text) => String(text).toLowerCase().includes(search))
    )
  }
  if (stockFilter) rows = rows.filter((row) => row.stock_status === stockFilter)
  if (expiryFilter) rows = rows.filter((row) => row.lots.some((lot) => lot.expiry_status === expiryFilter))

  // The row with the soonest expiry first, then the ones without an expiry date; then product, variant, location.
  rows.sort((a, b) => {
    const left = a.nearest_expiry_date
    const right = b.nearest_expiry_date
    if (left !== right) {
      if (!left) return 1
      if (!right) return -1
      return left < right ? -1 : 1
    }
    return (
      a.product.id - b.product.id ||
      (a.product.variant?.id ?? 0) - (b.product.variant?.id ?? 0) ||
      a.location.id - b.location.id
    )
  })
  return { rows, total: rows.length }
}
