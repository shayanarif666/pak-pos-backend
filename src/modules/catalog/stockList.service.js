import { Op } from "sequelize"
import { Category } from "./category.model.js"
import { Product } from "./product.model.js"
import { ProductStock } from "./productStock.model.js"
import { lotsByStock } from "./stockLots.service.js"
import { qtyForThreshold, thresholdUnit } from "./stockThreshold.js"
import { Location } from "../locations/location.model.js"
import { Supplier } from "../inventory/supplier.model.js"
import { AppError } from "../../shared/errors/AppError.js"

/*
 * GET /products/stock: the stock of every product, with its lots. One entry = one product, shown once:
 * a product with variants lists every variant, each with its stock; a product without variants
 * carries its stock itself. A stock is an array, one item per location (location, qty, status, lots);
 * a stock's lots (the stock that came in together, each with its own expiry date) are inside it,
 * soonest expiry first. Thresholds are fixed:
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

/** { number_of_packs, loose_items } of a qty of a pack product (whole packs and what is left over); both null otherwise. */
function packCountsOf(qty, product) {
  const size = Number(product.pack_size)
  if (!(product.is_pack_product && size >= 2)) return { number_of_packs: null, loose_items: null }
  const packs = Math.floor(Number(qty) / size)
  return { number_of_packs: packs, loose_items: round4(Number(qty) - packs * size) }
}

/** What a stock row says about how the thing is sold: pack or not, and whether single units are sold too. */
const flagsOf = (product) => ({
  is_pack_product: Boolean(product.is_pack_product),
  // Without a pack every unit is sold loose.
  sell_loose: product.is_pack_product ? Boolean(product.sell_loose) : true,
})

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
  // The supplier a lot came from { id (supplier number), name } (a deleted supplier keeps its name); null = none.
  const supplierIds = [...new Set([...lotMap.values()].flat().map((lot) => lot.supplier_id).filter(Boolean))]
  const suppliers = new Map(
    supplierIds.length
      ? (await Supplier.findAll({ where: { id: { [Op.in]: supplierIds } }, attributes: ["id", "supplier_number", "name"] })).map((row) => [row.id, { id: row.supplier_number, name: row.name }])
      : []
  )
  const now = new Date()

  let rows = stocks.map((stock) => {
    const product = stock.Product
    const parent = product.parent || null
    const location = locations.get(stock.location_id)
    const lots = (lotMap.get(`${stock.location_id}|${stock.product_id}`) || []).map((lot) => ({
      id: lot.lot_number,
      received_at: lot.received_at,
      supplier: suppliers.get(lot.supplier_id) || null,
      qty: round4(lot.qty),
      expiry_date: lot.expiry_date || null,
      days_to_expiry: daysToExpiry(lot.expiry_date, now),
      expiry_status: lotExpiryStatus(lot.expiry_date, now),
    }))
    const qty = round4(stock.qty)
    const threshold = stock.low_stock_threshold ?? product.low_stock_threshold
    const dates = lots.map((lot) => lot.expiry_date).filter(Boolean).sort()
    return {
      key: parent ? parent.id : product.id,
      product: {
        id: parent ? parent.product_number : product.product_number,
        title: parent ? parent.title : product.title,
        unit: product.unit,
        sku: parent ? parent.sku : product.sku,
        barcode: parent ? parent.barcode : product.barcode,
      },
      variant: parent ? { id: product.variant_number, name: product.variant_name, sku: product.sku, barcode: product.barcode, ...flagsOf(product) } : null,
      // The flags of a product without variants (a variant carries its own).
      flags: parent ? null : flagsOf(product),
      stock: {
        location: { id: location?.location_id_int ?? stock.location_id_int, name: location?.name || null },
        qty,
        pack_size: product.is_pack_product && Number(product.pack_size) >= 2 ? Number(product.pack_size) : null,
        ...packCountsOf(qty, product),
        // In packs for a pack-only product, else in units (piece / gram / kg): see low_stock_unit.
        low_stock_threshold: threshold == null ? null : round4(threshold),
        low_stock_unit: thresholdUnit(product),
        stock_status: stockStatus(qtyForThreshold(qty, product), threshold),
        nearest_expiry_date: dates[0] || null,
        lots,
      },
    }
  })

  // A filter picks the products with any stock that matches; all its variants and locations are still listed.
  const matches = (row) => {
    if (search) {
      const texts = [row.product.title, row.product.sku, row.product.barcode, row.variant?.name, row.variant?.sku, row.variant?.barcode]
      if (!texts.filter(Boolean).some((text) => String(text).toLowerCase().includes(search))) return false
    }
    if (stockFilter && row.stock.stock_status !== stockFilter) return false
    if (expiryFilter && !row.stock.lots.some((lot) => lot.expiry_status === expiryFilter)) return false
    return true
  }
  const wanted = new Set(rows.filter(matches).map((row) => row.key))

  // One entry per product: its stock per location, or its variants each with their stock per location.
  const groups = new Map()
  for (const row of rows) {
    if (!wanted.has(row.key)) continue
    const group = groups.get(row.key) || { product: row.product, flags: null, own: [], variants: new Map() }
    if (row.variant) {
      const variant = group.variants.get(row.variant.id) || { ...row.variant, stock: [] }
      variant.stock.push(row.stock)
      group.variants.set(row.variant.id, variant)
    } else {
      group.flags = row.flags
      group.own.push(row.stock)
    }
    groups.set(row.key, group)
  }
  const byLocation = (a, b) => a.location.id - b.location.id
  const totalOf = (stocks) => round4(stocks.reduce((sum, stock) => sum + stock.qty, 0))
  const list = [...groups.values()].map((group) => {
    const variants = [...group.variants.values()].sort((a, b) => a.id - b.id)
    for (const variant of variants) variant.stock.sort(byLocation)
    group.own.sort(byLocation)
    const dates = [...group.own, ...variants.flatMap((variant) => variant.stock)].map((stock) => stock.nearest_expiry_date).filter(Boolean).sort()
    // The flags and the total qty sit on the object that has the stock: each variant, or the product without variants.
    const shownVariants = variants.map((variant) => {
      const { stock, ...rest } = variant
      return { ...rest, total_qty: totalOf(stock), stock }
    })
    const product = variants.length
      ? { ...group.product, stock: null, variants: shownVariants }
      : { ...group.product, ...group.flags, total_qty: totalOf(group.own), stock: group.own, variants: [] }
    return { nearest: dates[0] || null, row: { product } }
  })

  // The product with the soonest expiry (any stock of it) first, then the ones without an expiry date; then product.
  list.sort((a, b) => {
    if (a.nearest !== b.nearest) {
      if (!a.nearest) return 1
      if (!b.nearest) return -1
      return a.nearest < b.nearest ? -1 : 1
    }
    return a.row.product.id - b.row.product.id
  })
  return { rows: list.map((item) => item.row), total: list.length }
}
