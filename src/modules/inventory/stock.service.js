import { publicVisibility } from "../../db/channelVisibility.js"
import { Op } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { StockMovement } from "./stockMovement.model.js"
import { Store } from "../stores/store.model.js"
import { Location } from "../locations/location.model.js"
import {
  getProduct,
  getProductByNumber,
  numberOfPacks,
  publicStock,
} from "../catalog/product.service.js"
import {
  applyStockDelta,
  loadLocation,
  resolveLocationId,
} from "../catalog/productStock.service.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"

const movementInclude = [
  { model: Store, attributes: ["id", "name"] },
  { model: Location, attributes: ["id", "name"] },
]

function publicMovement(row, extras = {}) {
  const json = row.toJSON ? row.toJSON() : row
  return {
    id: json.id,
    store_id: json.store_id,
    store_name: extras.store_name ?? json.Store?.name ?? null,
    location_id: json.location_id,
    location_name: extras.location_name ?? json.Location?.name ?? null,
    product_id: json.product_id,
    movement_type: json.movement_type,
    reason: json.reason,
    reason_note: json.reason_note,
    qty: Number(json.qty),
    qty_after: json.qty_after == null ? null : Number(json.qty_after),
    supplier_id: json.supplier_id,
    staff_id: json.staff_id,
    order_id: json.order_id,
    created_at: json.created_at,
    ...publicVisibility(json),
  }
}

export async function listMovements(actor, query = {}) {
  const where = { store_id: actor.store_id }
  if (actor.role !== "store_admin") where.location_id = actor.location_id
  else if (query.locationId || query.location_id) {
    where.location_id = query.locationId || query.location_id
  }
  if (query.productId || query.product_id) {
    where.product_id = query.productId || query.product_id
  }
  if (query.movement_type) where.movement_type = query.movement_type
  if (query.from || query.to) {
    where.created_at = {}
    if (query.from) where.created_at[Op.gte] = new Date(query.from)
    if (query.to) where.created_at[Op.lte] = new Date(query.to)
  }

  const rows = await StockMovement.findAll({
    where,
    include: movementInclude,
    order: [["created_at", "DESC"]],
  })
  return rows.map((row) => publicMovement(row))
}

export async function createMovement(actor, fields) {
  if (
    actor.role !== "store_admin" &&
    fields.location_id &&
    fields.location_id !== actor.location_id
  ) {
    throw new ForbiddenError("You can only adjust stock at your location")
  }

  const product = fields.product.product_id
    ? await getProduct(actor.store_id, fields.product.product_id)
    : await getProductByNumber(actor.store_id, fields.product.product_number)
  const locationId = resolveLocationId(actor, fields.location_id)
  if (!locationId) throw new ForbiddenError("No location on this account")
  const location = await loadLocation(actor.store_id, locationId)
  const store = await Store.findByPk(actor.store_id)

  return sequelize.transaction(async (transaction) => {
    const { stock, movement } = await applyStockDelta(
      {
        storeId: actor.store_id,
        storeIdInt: actor.store_id_int,
        location,
        productId: product.id,
        delta: fields.qty,
        movement_type: fields.movement_type,
        reason: fields.reason,
        reason_note: fields.reason_note,
        staff_id: actor.id,
        expiry_date: fields.expiry_date,
        visibility: fields.visibility,
      },
      { transaction }
    )

    return {
      movement: movement
        ? publicMovement(movement, {
            store_name: store?.name || null,
            location_name: location.name,
          })
        : null,
      stock: publicStock(stock, product),
      summary: stockSummary(product, Number(stock.qty)),
    }
  })
}

/**
 * The POS response: the product's number and its stock at this location after the movement.
 * Pack products also get pack_size and how many full packs that stock makes.
 */
function stockSummary(product, qty) {
  const packSize = Number(product.pack_size)
  if (product.is_pack_product && packSize >= 2) {
    return {
      product_id: product.product_number,
      pack_size: packSize,
      number_of_packs: numberOfPacks(qty, packSize),
      qty,
    }
  }
  return { product_id: product.product_number, qty }
}
