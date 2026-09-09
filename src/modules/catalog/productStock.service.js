import { Op } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { ProductStock } from "./productStock.model.js"
import { Product } from "./product.model.js"
import { Location } from "../locations/location.model.js"
import { StockMovement } from "../inventory/stockMovement.model.js"
import { getProduct, publicStock } from "./product.service.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

function resolveLocationId(actor, requested) {
  return requested || actor.location_id || null
}

async function loadLocation(storeId, locationId) {
  if (!locationId) throw new AppError("location_id is required", 400)
  const location = await Location.findOne({
    where: { id: locationId, store_id: storeId },
  })
  if (!location) throw new NotFoundError("Location not found")
  return location
}

export async function listStocks(actor, query = {}) {
  const locationId = resolveLocationId(
    actor,
    query.locationId || query.location_id
  )
  const where = { store_id: actor.store_id }
  if (locationId) where.location_id = locationId

  const rows = await ProductStock.findAll({
    where,
    include: [{ model: Product }],
    order: [["updated_at", "DESC"]],
  })
  return rows.map((row) => publicStock(row, row.Product))
}

export async function getStock(actor, id) {
  const where = { id, store_id: actor.store_id }
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
  const where = { store_id: actor.store_id }
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
  },
  { transaction }
) {
  if (!transaction) throw new AppError("Stock change requires a transaction", 500)
  if (!location) throw new AppError("location is required", 400)

  let row = await ProductStock.findOne({
    where: { location_id: location.id, product_id: productId },
    transaction,
  })
  const oldQty = row ? Number(row.qty) : 0
  const newQty = oldQty + Number(delta)
  if (newQty < 0) throw new AppError("qty cannot be negative", 400)

  const patch = { qty: newQty }
  if (low_stock_threshold !== undefined) patch.low_stock_threshold = low_stock_threshold

  if (!row) {
    row = await ProductStock.create(
      {
        store_id: storeId,
        store_id_int: storeIdInt,
        location_id: location.id,
        location_id_int: location.location_id_int,
        product_id: productId,
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
        location_id: location.id,
        location_id_int: location.location_id_int,
        product_id: productId,
        movement_type,
        reason,
        reason_note: reason_note || null,
        qty: signed,
        qty_after: newQty,
        staff_id: staff_id || null,
        supplier_id: supplier_id || null,
        order_id: order_id || null,
      },
      { transaction }
    )
  }

  return { stock: row, movement, qty: newQty }
}

export async function putStock(actor, productId, fields) {
  const product = await getProduct(actor.store_id, productId)
  const locationId = resolveLocationId(actor, fields.location_id)
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
    const movement_type = signed > 0 ? "stock_in" : signed < 0 ? "stock_out" : "adjustment"
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
      },
      { transaction }
    )

    return publicStock(stock, product)
  })
}

export { loadLocation, resolveLocationId }
