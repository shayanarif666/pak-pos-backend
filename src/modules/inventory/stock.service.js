import { publicVisibility } from "../../db/channelVisibility.js"
import { Op } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { StockMovement } from "./stockMovement.model.js"
import { Store } from "../stores/store.model.js"
import { Location } from "../locations/location.model.js"
import { User } from "../auth/user.model.js"
import { Supplier } from "./supplier.model.js"
import {
  getProduct,
  getProductByNumber,
  numberOfPacks,
  publicStock,
  stockPlaces,
} from "../catalog/product.service.js"
import { Product } from "../catalog/product.model.js"
import { ProductStock } from "../catalog/productStock.model.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { AppError } from "../../shared/errors/AppError.js"
import {
  applyStockDelta,
  loadLocation,
  resolveLocationId,
} from "../catalog/productStock.service.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import { toItemQty } from "../../shared/utils/stockUnit.util.js"

const movementInclude = [
  { model: Store, attributes: ["id", "name"] },
  { model: Location, attributes: ["id", "name", "location_id_int"] },
  // Who did it (the store admin too, who is not in the staff list).
  { model: User, as: "staff", attributes: ["id", "user_number", "name", "role"] },
  { model: Supplier, attributes: ["id", "supplier_number", "name"] },
]

/** product / variant of a movement: a variant shows its product and its own number and name. */
async function productRefs(productIds) {
  const ids = [...new Set(productIds.filter(Boolean))]
  if (!ids.length) return new Map()
  const rows = await Product.findAll({
    where: { id: { [Op.in]: ids } },
    attributes: ["id", "product_number", "title", "sku", "unit", "parent_product_id", "variant_number", "variant_name"],
    include: [{ model: Product, as: "parent", attributes: ["id", "product_number", "title", "sku", "unit"] }],
  })
  return new Map(
    rows.map((row) => {
      const main = row.parent || row
      return [
        row.id,
        {
          product: { id: main.id, product_number: main.product_number, title: main.title, sku: main.sku, unit: main.unit },
          variant: row.parent ? { id: row.id, variant_number: row.variant_number, name: row.variant_name, sku: row.sku } : null,
        },
      ]
    })
  )
}

function publicMovement(row, extras = {}) {
  const json = row.toJSON ? row.toJSON() : row
  return {
    id: json.id,
    movement_number: json.movement_number,
    store_id: json.store_id,
    store_name: extras.store_name ?? json.Store?.name ?? null,
    location_id: json.location_id,
    location_name: extras.location_name ?? json.Location?.name ?? null,
    location_number: extras.location_number ?? json.Location?.location_id_int ?? null,
    product_id: json.product_id,
    product: extras.refs?.product ?? null,
    variant: extras.refs?.variant ?? null,
    movement_type: json.movement_type,
    reason: json.reason,
    reason_note: json.reason_note,
    qty: Number(json.qty),
    qty_after: json.qty_after == null ? null : Number(json.qty_after),
    supplier_id: json.supplier_id,
    supplier: json.Supplier ? { id: json.Supplier.id, supplier_number: json.Supplier.supplier_number, name: json.Supplier.name } : null,
    staff_id: json.staff_id,
    staff: json.staff ? { id: json.staff.id, user_number: json.staff.user_number, name: json.staff.name, role: json.staff.role } : null,
    order_id: json.order_id,
    created_at: json.created_at,
    // When it was last edited (null = never).
    updated_at: json.updated_at || null,
    ...publicVisibility(json),
  }
}

export async function listMovements(actor, query = {}) {
  const where = { store_id: actor.store_id }
  if (actor.role !== "store_admin") where.location_id = actor.location_id
  else if (query.locationId || query.location_id) {
    where.location_id = query.locationId || query.location_id
  }
  const productRef = query.productId || query.product_id
  if (productRef) {
    // A product's number or UUID: its own movements and its variants'.
    const product = await Product.findOne({
      where: /^\d+$/.test(String(productRef))
        ? { store_id: actor.store_id, product_number: Number(productRef) }
        : { store_id: actor.store_id, id: productRef },
      attributes: ["id"],
    })
    if (!product) return []
    const variants = await Product.findAll({ where: { parent_product_id: product.id }, attributes: ["id"] })
    where.product_id = [product.id, ...variants.map((row) => row.id)]
  }
  if (query.movement_type) where.movement_type = query.movement_type
  if (query.reason) where.reason = query.reason
  if (query.from || query.to) {
    where.created_at = {}
    if (query.from) where.created_at[Op.gte] = new Date(query.from)
    if (query.to) where.created_at[Op.lte] = new Date(query.to)
  }

  const rows = await StockMovement.findAll({
    where,
    include: movementInclude,
    order: [["created_at", "DESC"], ["movement_number", "DESC"]],
  })
  const refs = await productRefs(rows.map((row) => row.product_id))
  return rows.map((row) => publicMovement(row, { refs: refs.get(row.product_id) }))
}

/**
 * Stock movements of one product: one per variant / location in fields.units. Each location must
 * be one the product is sold at (a manager / cashier only their own). A product with variants
 * moves each variant's stock; a unit that fails is listed in failed[] and the others still save.
 */
export async function createMovements(actor, fields) {
  const product = fields.product.product_id
    ? await getProduct(actor.store_id, fields.product.product_id)
    : await getProductByNumber(actor.store_id, fields.product.product_number)
  const { sold } = await stockPlaces(product)
  const byRef = new Map(sold.flatMap((row) => [[row.id, row], [String(row.location_id_int), row]]))
  const created = []
  const failed = []
  for (const unit of fields.units) {
    try {
      let target = product
      if (unit.variant) {
        if (!product.has_variants) throw new AppError(`${product.title} has no variants; send stock without variants`, 400)
        target = (product.variants || []).find(
          (row) => String(row.variant_number) === unit.variant || row.id === unit.variant
        )
        if (!target) throw new NotFoundError(`Variant ${unit.variant} is not a variant of ${product.title}`)
      } else if (product.has_variants) {
        throw new AppError(`${product.title} has variants: send variants [{ id, stock }]`, 400)
      }
      const requested = unit.location ?? fields.location_id
      const locationId = resolveLocationId(actor, requested)
      if (!locationId) throw new ForbiddenError("No location on this account")
      const location = await loadLocation(actor.store_id, locationId)
      // A manager / cashier may name their own location (number or UUID), never another one.
      if (actor.role !== "store_admin" && requested && (await loadLocation(actor.store_id, requested)).id !== location.id) {
        throw new ForbiddenError("You can only move stock at your location")
      }
      if (!byRef.has(location.id)) throw new AppError(`${product.title} is not sold at ${location.name}`, 400)
      // stock_unit pack: unit.qty is whole packs of a pack product, moved as packs × pack_size items.
      const qty = toItemQty(target, unit.qty, unit.stock_unit)
      created.push(await moveOne(actor, target, location, { ...fields, qty, expiry_date: unit.expiry_date }))
    } catch (err) {
      failed.push({
        variant_id: unit.variant ? (/^\d+$/.test(unit.variant) ? Number(unit.variant) : unit.variant) : null,
        location_id: unit.location ?? fields.location_id ?? null,
        message: err.message || "Failed",
        status: err.statusCode || err.status || 400,
      })
    }
  }
  return { created, failed }
}

/** One movement of a sellable product at a location. */
async function moveOne(actor, product, location, fields) {
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
        supplier_id: fields.supplier_id || null,
      },
      { transaction }
    )
    const refs = (await productRefs([product.id])).get(product.id)
    return {
      movement: movement
        ? publicMovement(movement, {
            store_name: store?.name || null,
            location_name: location.name,
            location_number: location.location_id_int,
            refs,
          })
        : null,
      stock: publicStock(stock, product),
      summary: stockSummary(product, Number(stock.qty)),
    }
  })
}

export async function createMovement(actor, fields) {
  const product = fields.product.product_id
    ? await getProduct(actor.store_id, fields.product.product_id)
    : await getProductByNumber(actor.store_id, fields.product.product_number)
  const locationId = resolveLocationId(actor, fields.location_id)
  if (!locationId) throw new ForbiddenError("No location on this account")
  const location = await loadLocation(actor.store_id, locationId)
  // A manager / cashier may name their own location (number or UUID), never another one.
  if (
    actor.role !== "store_admin" &&
    fields.location_id &&
    (await loadLocation(actor.store_id, fields.location_id)).id !== location.id
  ) {
    throw new ForbiddenError("You can only adjust stock at your location")
  }
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
        supplier_id: fields.supplier_id || null,
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

// ---- Edit / soft delete of a movement (dashboard: Stock Movements) ----

const EDITABLE_TYPES = ["stock_in", "stock_out", "adjustment"]
// Written by a sale, refund or transfer: those change with the order / transfer, never here.
const LOCKED_REASONS = ["sale", "refund", "transfer", "custom_sale"]

/** The movement by its number (1, 2, 3…) or UUID; a manager / cashier only at their location. */
async function findMovement(actor, ref, transaction) {
  const value = String(ref ?? "").trim()
  const where = /^\d+$/.test(value)
    ? { store_id: actor.store_id, movement_number: Number(value) }
    : { store_id: actor.store_id, id: value }
  const row = await StockMovement.findOne({ where, transaction, lock: transaction?.LOCK.UPDATE })
  if (!row) throw new NotFoundError("Stock movement not found")
  if (actor.role !== "store_admin" && row.location_id !== actor.location_id) {
    throw new NotFoundError("Stock movement not found")
  }
  return row
}

function assertEditable(row, action) {
  if (!EDITABLE_TYPES.includes(row.movement_type) || LOCKED_REASONS.includes(row.reason) || row.order_id) {
    throw new AppError(
      `This ${String(row.movement_type).replaceAll("_", " ")} movement comes from a sale, refund or transfer and cannot be ${action} here`,
      409
    )
  }
}

/**
 * Moves the stock at the movement's product + location by diff, and shifts "stock after" of
 * every later movement there by the same amount (so the history still adds up).
 */
async function shiftStock(row, diff, transaction) {
  const stock = await ProductStock.findOne({
    where: { location_id: row.location_id, product_id: row.product_id },
    transaction,
    lock: transaction.LOCK.UPDATE,
  })
  const current = stock ? Number(stock.qty) : 0
  const next = current + diff
  if (next < 0) {
    throw new AppError(
      `Stock cannot go below 0: there are ${current} left, and this change takes away ${Math.abs(diff)}`,
      400
    )
  }
  // Nor at any point since this movement (stock after of this one and the later ones).
  if (diff < 0) {
    const lowest = await StockMovement.min("qty_after", {
      where: {
        store_id: row.store_id,
        location_id: row.location_id,
        product_id: row.product_id,
        movement_number: { [Op.gte]: row.movement_number },
        qty_after: { [Op.ne]: null },
      },
      transaction,
    })
    if (lowest != null && Number(lowest) + diff < 0) {
      throw new AppError(
        `Stock cannot go below 0: after this movement it dropped to ${Number(lowest)}, and this change takes away ${Math.abs(diff)} more`,
        400
      )
    }
  }
  // A deleted stock entry that gets stock back shows again.
  if (stock && diff !== 0) await stock.update({ qty: next, ...(stock.deleted_at && next > 0 ? { deleted_at: null } : {}) }, { transaction })
  if (diff !== 0) {
    await StockMovement.increment(
      { qty_after: diff },
      {
        where: {
          store_id: row.store_id,
          location_id: row.location_id,
          product_id: row.product_id,
          movement_number: { [Op.gt]: row.movement_number },
          qty_after: { [Op.ne]: null },
        },
        transaction,
      }
    )
  }
  return stock
}

/**
 * One row of PATCH /stock-movements/bulk — fixes a wrong movement: movement_type, reason, qty,
 * reason_note (only what is sent changes). The difference is put on the stock at once.
 * Returns { movementId, stockId } (stockEditView shapes the reply).
 */
export async function updateMovement(actor, ref, fields) {
  return sequelize.transaction(async (transaction) => {
    const row = await findMovement(actor, ref, transaction)
    assertEditable(row, "edited")
    const type = fields.movement_type ?? row.movement_type
    if (fields.reason === "opening_balance" && row.reason !== "opening_balance") {
      throw new AppError("opening_balance is only for the stock a product was created with", 400)
    }
    const oldQty = Number(row.qty)
    // Same amount, new type: stock_in adds, stock_out takes away, an adjustment keeps the sign.
    const raw = fields.qty ?? oldQty
    const qty = type === "stock_in" ? Math.abs(raw) : type === "stock_out" ? -Math.abs(raw) : Number(raw)
    if (!qty) throw new AppError("qty must be a non-zero number", 400)
    const diff = qty - oldQty
    const stock = await shiftStock(row, diff, transaction)
    await row.update(
      {
        movement_type: type,
        reason: fields.reason ?? row.reason,
        ...(fields.reason_note !== undefined ? { reason_note: fields.reason_note } : {}),
        qty,
        qty_after: row.qty_after == null ? null : Number(row.qty_after) + diff,
        updated_at: new Date(),
      },
      { transaction }
    )
    return { movementId: row.id, stockId: stock?.id || null }
  })
}

/** DELETE /stock-movements/:id — soft delete: its qty is taken back off the stock. */
export async function deleteMovement(actor, ref) {
  return sequelize.transaction(async (transaction) => {
    const row = await findMovement(actor, ref, transaction)
    assertEditable(row, "deleted")
    const stock = await shiftStock(row, -Number(row.qty), transaction)
    await row.destroy({ transaction })
    return { movementId: row.id, stockId: stock?.id || null }
  })
}
