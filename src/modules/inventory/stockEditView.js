import { Op } from "sequelize"
import { Product } from "../catalog/product.model.js"
import { ProductStock } from "../catalog/productStock.model.js"
import { Location } from "../locations/location.model.js"
import { User } from "../auth/user.model.js"
import { Supplier } from "./supplier.model.js"
import { StockMovement } from "./stockMovement.model.js"

/*
 * Replies of the stock edit APIs (PATCH /stock-movements/bulk, PATCH /product-stocks/bulk and the
 * deletes): short numbers only, never UUIDs — each reference is { id (its number), name… }.
 *
 *   movement: { id (movement number), location, product, staff, supplier, movement_type, reason,
 *               reason_note, qty, qty_after, created_at, updated_at[, deleted_at] }
 *   stock:    { location, product, qty, pack_size, number_of_packs, loose_units, sell_loose,
 *               expiry_date, low_stock_threshold, is_low, updated_at[, deleted_at] }
 *   product:  { id, title, sku, barcode, unit, variant: null | { id, title, sku, barcode } }
 */

const num = (value) => (value == null ? null : Number(value))

async function mapById(model, ids, attributes, options = {}) {
  const list = [...new Set(ids.filter(Boolean))]
  if (!list.length) return new Map()
  const rows = await model.findAll({ where: { id: { [Op.in]: list } }, attributes, ...options })
  return new Map(rows.map((row) => [row.id, row]))
}

const PRODUCT_ATTRS = [
  "id", "product_number", "title", "sku", "barcode", "unit", "parent_product_id", "variant_number",
  "variant_name", "is_pack_product", "pack_size", "sell_loose", "low_stock_threshold",
]

function productView(row, parent) {
  if (!row) return null
  if (!parent) {
    return { id: row.product_number, title: row.title, sku: row.sku, barcode: row.barcode || null, unit: row.unit, variant: null }
  }
  return {
    id: parent.product_number,
    title: parent.title,
    sku: parent.sku,
    barcode: parent.barcode || null,
    unit: row.unit || parent.unit,
    variant: { id: row.variant_number, title: row.variant_name, sku: row.sku, barcode: row.barcode || null },
  }
}

/** pairs: [{ movementId, stockId }] (either may be null) → [{ movement, stock }]. */
export async function stockEditRows(pairs) {
  const movements = await mapById(StockMovement, pairs.map((pair) => pair.movementId), undefined, { paranoid: false })
  const stocks = await mapById(ProductStock, pairs.map((pair) => pair.stockId))
  const productIds = [...[...movements.values()].map((row) => row.product_id), ...[...stocks.values()].map((row) => row.product_id)]
  const products = await mapById(Product, productIds, PRODUCT_ATTRS)
  const parents = await mapById(Product, [...products.values()].map((row) => row.parent_product_id), PRODUCT_ATTRS)
  const locations = await mapById(
    Location,
    [...[...movements.values()].map((row) => row.location_id), ...[...stocks.values()].map((row) => row.location_id)],
    ["id", "location_id_int", "name"]
  )
  const users = await mapById(User, [...movements.values()].map((row) => row.staff_id), ["id", "user_number", "name", "role"], { paranoid: false })
  const suppliers = await mapById(Supplier, [...movements.values()].map((row) => row.supplier_id), ["id", "supplier_number", "name"])

  const location = (id) => {
    const row = locations.get(id)
    return row ? { id: row.location_id_int, name: row.name } : null
  }
  const product = (id) => {
    const row = products.get(id)
    return productView(row, row?.parent_product_id ? parents.get(row.parent_product_id) : null)
  }

  const movementView = (row) => {
    if (!row) return null
    const staff = users.get(row.staff_id)
    const supplier = suppliers.get(row.supplier_id)
    return {
      id: row.movement_number,
      location: location(row.location_id),
      product: product(row.product_id),
      staff: staff ? { id: staff.user_number, name: staff.name, role: staff.role } : null,
      supplier: supplier ? { id: supplier.supplier_number, name: supplier.name } : null,
      movement_type: row.movement_type,
      reason: row.reason,
      reason_note: row.reason_note || null,
      qty: num(row.qty),
      qty_after: num(row.qty_after),
      created_at: row.created_at,
      updated_at: row.updated_at || null,
      ...(row.deleted_at ? { deleted_at: row.deleted_at } : {}),
    }
  }

  const stockView = (row) => {
    if (!row) return null
    const item = products.get(row.product_id)
    const parent = item?.parent_product_id ? parents.get(item.parent_product_id) : null
    const qty = Number(row.qty)
    const isPack = Boolean(item?.is_pack_product)
    const packSize = isPack ? Number(item.pack_size) || null : null
    // The store's own level here, else the one set on the product (variant, then its product).
    const threshold = num(row.low_stock_threshold ?? item?.low_stock_threshold ?? parent?.low_stock_threshold)
    return {
      location: location(row.location_id),
      product: product(row.product_id),
      qty,
      pack_size: packSize,
      number_of_packs: packSize >= 2 ? Math.floor(qty / packSize) : null,
      loose_units: packSize >= 2 ? Math.round((qty - Math.floor(qty / packSize) * packSize) * 10000) / 10000 : null,
      sell_loose: isPack ? Boolean(item.sell_loose) : null,
      expiry_date: row.expiry_date || null,
      low_stock_threshold: threshold,
      is_low: threshold == null ? false : qty <= threshold,
      updated_at: row.updated_at,
      ...(row.deleted_at ? { deleted_at: row.deleted_at } : {}),
    }
  }

  return pairs.map((pair) => ({
    movement: movementView(movements.get(pair.movementId)),
    stock: stockView(stocks.get(pair.stockId)),
  }))
}
