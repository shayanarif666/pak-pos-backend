import { Op } from "sequelize"
import { copyVisibility } from "../../db/channelVisibility.js"
import { sequelize } from "../../db/sequelize.js"
import { ProductStock } from "./productStock.model.js"
import { Product } from "./product.model.js"
import { Location } from "../locations/location.model.js"
import { Store } from "../stores/store.model.js"
import { StockMovement } from "../inventory/stockMovement.model.js"
import { getProduct, publicStock } from "./product.service.js"
import { nextStockMovementNumber } from "../../shared/utils/counter.util.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

// Only the store admin may pick a branch; managers and cashiers are pinned to their own.
function resolveLocationId(actor, requested) {
  if (actor.role === "store_admin") return requested || actor.location_id || null
  return actor.location_id || null
}

async function loadLocation(storeId, locationId) {
  if (!locationId) throw new AppError("location_id is required", 400)
  // The location's UUID, or its number (1, 2, 3...) as the POS sends it.
  const where = /^\d+$/.test(String(locationId))
    ? { location_id_int: Number(locationId), store_id: storeId }
    : { id: locationId, store_id: storeId }
  const location = await Location.findOne({ where })
  if (!location) throw new NotFoundError("Location not found")
  return location
}

export async function listStocks(actor, query = {}) {
  const locationId = resolveLocationId(
    actor,
    query.locationId || query.location_id
  )
  const where = { store_id: actor.store_id, deleted_at: null }
  if (locationId) where.location_id = locationId

  const rows = await ProductStock.findAll({
    where,
    include: [{ model: Product }],
    order: [["updated_at", "DESC"]],
  })
  return rows.map((row) => publicStock(row, row.Product))
}

export async function getStock(actor, id) {
  const where = { id, store_id: actor.store_id, deleted_at: null }
  if (actor.role !== "store_admin") where.location_id = actor.location_id
  const row = await ProductStock.findOne({
    where,
    include: [{ model: Product }],
  })
  if (!row) throw new NotFoundError("Stock not found")
  return publicStock(row, row.Product)
}

export async function listLowStocks(actor, query = {}) {
  const locationId = resolveLocationId(
    actor,
    query.locationId || query.location_id
  )
  const where = { store_id: actor.store_id, deleted_at: null }
  if (locationId) where.location_id = locationId

  const rows = await ProductStock.findAll({
    where,
    include: [{ model: Product }],
  })

  return rows
    .map((row) => publicStock(row, row.Product))
    .filter((row) => row.is_low)
}

export async function applyStockDelta(
  {
    storeId,
    storeIdInt,
    location,
    productId,
    delta,
    movement_type,
    reason,
    reason_note,
    staff_id,
    supplier_id,
    order_id,
    low_stock_threshold,
    expiry_date,
    visibility,
  },
  { transaction }
) {
  if (!transaction) throw new AppError("Stock change requires a transaction", 500)
  if (!location) throw new AppError("location is required", 400)

  // Lock the stock row: two tills selling the same product at once must not both read
  // the old qty and overwrite each other (lost update / oversell).
  let row = await ProductStock.findOne({
    where: { location_id: location.id, product_id: productId },
    transaction,
    lock: transaction.LOCK.UPDATE,
  })
  const oldQty = row ? Number(row.qty) : 0
  const newQty = oldQty + Number(delta)
  if (newQty < 0) throw new AppError("qty cannot be negative", 400)

  // unit_sold = units sold so far here: a sale (including a manual sale adjustment) adds the
  // units that left, a refund takes back the units that came back.
  const oldSold = row ? Number(row.unit_sold || 0) : 0
  const soldDelta = ["sale", "refund"].includes(reason) ? -Number(delta) : 0
  const newSold = Math.max(0, oldSold + soldDelta)

  const patch = { qty: newQty, unit_sold: newSold }
  if (low_stock_threshold !== undefined) patch.low_stock_threshold = low_stock_threshold
  if (expiry_date !== undefined) patch.expiry_date = expiry_date
  // A deleted stock entry comes back with the next movement (without its old expiry date).
  if (row?.deleted_at) {
    patch.deleted_at = null
    if (expiry_date === undefined) patch.expiry_date = null
  }

  if (!row) {
    const product = await Product.findByPk(productId, { transaction })
    row = await ProductStock.create(
      {
        store_id: storeId,
        store_id_int: storeIdInt,
        location_id: location.id,
        location_id_int: location.location_id_int,
        product_id: productId,
        ...copyVisibility(product),
        ...patch,
      },
      { transaction }
    )
  } else {
    await row.update(patch, { transaction })
  }

  let movement = null
  const signed = Number(delta)
  if (signed !== 0) {
    movement = await StockMovement.create(
      {
        store_id: storeId,
        store_id_int: storeIdInt,
        movement_number: await nextStockMovementNumber(storeId, transaction),
        location_id: location.id,
        location_id_int: location.location_id_int,
        product_id: productId,
        movement_type,
        reason,
        reason_note: reason_note || null,
        qty: signed,
        qty_after: newQty,
        unit_sold: newSold,
        staff_id: staff_id || null,
        supplier_id: supplier_id || null,
        order_id: order_id || null,
        // A manual movement may name its own visibility; otherwise it follows the stock row.
        ...(visibility || copyVisibility(row)),
      },
      { transaction }
    )
  }

  return { stock: row, movement, qty: newQty }
}

export async function putStock(actor, productId, fields) {
  const product = await getProduct(actor.store_id, productId)
  let locationId = resolveLocationId(actor, fields.location_id)
  if (!locationId) {
    const store = await Store.findByPk(actor.store_id)
    locationId = store?.default_location_id || null
  }
  if (actor.role !== "store_admin" && fields.location_id && fields.location_id !== actor.location_id) {
    throw new ForbiddenError("You can only change stock at your location")
  }
  const location = await loadLocation(actor.store_id, locationId)

  return sequelize.transaction(async (transaction) => {
    const existing = await ProductStock.findOne({
      where: { location_id: location.id, product_id: product.id },
      transaction,
    })
    const oldQty = existing ? Number(existing.qty) : 0
    let newQty = oldQty
    if (fields.qty !== undefined) newQty = Number(fields.qty)
    else if (fields.delta !== undefined) newQty = oldQty + Number(fields.delta)

    const signed = newQty - oldQty
    const derived = signed > 0 ? "stock_in" : signed < 0 ? "stock_out" : "adjustment"
    // A sent movement_type must match the direction: stock_in adds, stock_out takes away.
    if (fields.movement_type === "stock_in" && signed < 0) {
      throw new AppError("stock_in cannot lower the stock", 400)
    }
    if (fields.movement_type === "stock_out" && signed > 0) {
      throw new AppError("stock_out cannot raise the stock", 400)
    }
    const movement_type = fields.movement_type || derived
    const reason =
      fields.reason ||
      (oldQty !== 0 ? (signed > 0 ? "purchase" : "count") : "opening_balance")

    const { stock } = await applyStockDelta(
      {
        storeId: actor.store_id,
        storeIdInt: actor.store_id_int,
        location,
        productId: product.id,
        delta: signed,
        movement_type,
        reason,
        reason_note: fields.reason_note,
        staff_id: actor.id,
        low_stock_threshold: fields.low_stock_threshold,
        expiry_date: fields.expiry_date,
      },
      { transaction }
    )

    return publicStock(stock, product)
  })
}

// ---- Stock edit (dashboard: Product Stock & Expiry; POS sync) ----

/** A stock entry by its UUID (the dashboard's delete); a manager / cashier only at their location. */
async function findStockEntry(actor, id, transaction) {
  const where = { id, store_id: actor.store_id, deleted_at: null }
  if (actor.role !== "store_admin") where.location_id = actor.location_id
  const row = await ProductStock.findOne({ where, transaction, lock: transaction.LOCK.UPDATE })
  if (!row) throw new NotFoundError("Stock entry not found")
  return row
}

/**
 * One row of PATCH /product-stocks/bulk: the stock of a product (or variant) at a location.
 * qty = the new total (or delta +/-, or number_of_packs + loose_units for a pack product),
 * expiry_date, low_stock_threshold. A qty change writes a movement (adjustment / count unless
 * movement_type / reason are sent). Returns { movementId, stockId } for stockEditRows().
 */
export async function editStock(actor, productId, locationRef, fields) {
  const locationId = resolveLocationId(actor, locationRef)
  if (!locationId) throw new AppError("location_id is required", 400)
  const location = await loadLocation(actor.store_id, locationId)
  // A manager / cashier may name their own location (number or UUID), never another one.
  if (actor.role !== "store_admin" && locationRef && (await loadLocation(actor.store_id, locationRef)).id !== location.id) {
    throw new ForbiddenError("You can only change stock at your location")
  }
  const product = await Product.findOne({ where: { id: productId, store_id: actor.store_id } })
  if (!product) throw new NotFoundError("Product not found")
  if (product.has_variants) throw new AppError(`${product.title} has variants: send variant_id (the variant number)`, 400)

  let qty = fields.qty
  if (fields.number_of_packs !== undefined || fields.loose_units !== undefined) {
    const packSize = Number(product.pack_size)
    if (!product.is_pack_product || !(packSize >= 2)) {
      throw new AppError(`${product.title} is not a pack product: send qty (units)`, 400)
    }
    if (!product.sell_loose && fields.loose_units) {
      throw new AppError(`${product.title} is sold only in whole packs: send number_of_packs without loose_units`, 400)
    }
    qty = (fields.number_of_packs || 0) * packSize + (fields.loose_units || 0)
  }

  return sequelize.transaction(async (transaction) => {
    const row = await ProductStock.findOne({
      where: { location_id: location.id, product_id: product.id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    })
    const oldQty = row ? Number(row.qty) : 0
    const newQty = qty !== undefined ? qty : fields.delta !== undefined ? oldQty + fields.delta : oldQty
    const signed = newQty - oldQty
    if (fields.movement_type === "stock_in" && signed < 0) throw new AppError("stock_in cannot lower the stock", 400)
    if (fields.movement_type === "stock_out" && signed > 0) throw new AppError("stock_out cannot raise the stock", 400)
    const { stock, movement } = await applyStockDelta(
      {
        storeId: actor.store_id,
        storeIdInt: actor.store_id_int,
        location,
        productId: product.id,
        delta: signed,
        movement_type: fields.movement_type || "adjustment",
        reason: fields.reason || (row ? "count" : "opening_balance"),
        reason_note: fields.reason_note,
        staff_id: actor.id,
        low_stock_threshold: fields.low_stock_threshold,
        expiry_date: fields.expiry_date,
      },
      { transaction }
    )
    return { movementId: movement?.id || null, stockId: stock.id }
  })
}

/**
 * DELETE /product-stocks/:id — soft delete: the qty goes to 0 through an adjustment movement
 * (reason other), then the entry leaves the stock & expiry lists. A later movement brings it back.
 */
export async function deleteStockEntry(actor, id, { reason_note } = {}) {
  return sequelize.transaction(async (transaction) => {
    const row = await findStockEntry(actor, id, transaction)
    const location = await Location.findByPk(row.location_id, { transaction })
    const result = await applyStockDelta(
      {
        storeId: row.store_id,
        storeIdInt: row.store_id_int,
        location,
        productId: row.product_id,
        delta: -Number(row.qty),
        movement_type: "adjustment",
        reason: "other",
        reason_note: `Stock entry deleted${reason_note ? `: ${reason_note}` : ""}`,
        staff_id: actor.id,
      },
      { transaction }
    )
    await ProductStock.update({ deleted_at: new Date() }, { where: { id: row.id }, transaction })
    return { movementId: result.movement?.id || null, stockId: row.id }
  })
}

export { loadLocation, resolveLocationId }
