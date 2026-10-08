import { Op } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { Supplier } from "./supplier.model.js"
import { SupplierLedger } from "./supplierLedger.model.js"
import { SupplierLocation } from "./supplierLocation.model.js"
import { Location } from "../locations/location.model.js"
import { getProduct } from "../catalog/product.service.js"
import {
  applyStockDelta,
  loadLocation,
} from "../catalog/productStock.service.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import { copyVisibility, publicVisibility } from "../../db/channelVisibility.js"

const SUPPLIER_LOCATIONS_INCLUDE = {
  model: SupplierLocation,
  as: "supplierLocations",
  attributes: ["location_id"],
  include: [{ model: Location, attributes: ["id", "name"] }],
}

function publicSupplier(row, extras = {}) {
  const links = row.supplierLocations || []
  return {
    id: row.id,
    store_id: row.store_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    payment_terms: row.payment_terms,
    // "all" = every branch; "selected" = only the branches in location_ids.
    location_scope: row.location_scope || "all",
    location_ids: links.map((link) => link.location_id),
    locations: links.map((link) => ({
      id: link.location_id,
      name: link.Location?.name || null,
    })),
    is_active: row.is_active,
    ...publicVisibility(row),
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...extras,
  }
}

async function ledgerBalance(storeId, supplierId, transaction) {
  const rows = await SupplierLedger.findAll({
    where: { store_id: storeId, supplier_id: supplierId },
    transaction,
  })
  return rows.reduce((sum, row) => {
    const amount = Number(row.amount)
    return row.entry_type === "debit" ? sum + amount : sum - amount
  }, 0)
}

/** Managers work with one branch only; store admins see every branch (or the one they filter). */
function scopedLocationId(actor, query = {}) {
  if (actor?.role === "manager") return actor.location_id || null
  return query.location_id || query.locationId || null
}

function servesLocation(row, locationId) {
  if (!locationId || row.location_scope !== "selected") return true
  return (row.supplierLocations || []).some((link) => link.location_id === locationId)
}

async function loadSupplier(storeId, id, transaction) {
  const row = await Supplier.findOne({
    where: { id, store_id: storeId },
    include: [SUPPLIER_LOCATIONS_INCLUDE],
    transaction,
  })
  if (!row) throw new NotFoundError("Supplier not found")
  return row
}

/**
 * Managers create suppliers for their own branch and may only pick their own branch; "all
 * locations" and other branches are store admin decisions.
 */
function resolveScopeForActor(actor, fields, { creating }) {
  if (actor?.role !== "manager") return fields
  if (!actor.location_id) throw new ForbiddenError("Manager has no location")

  const touchesScope = fields.location_scope !== undefined
  if (creating && !touchesScope) {
    return { ...fields, location_scope: "selected", location_ids: [actor.location_id] }
  }
  if (!touchesScope) return fields
  const ownOnly =
    fields.location_scope === "selected" &&
    fields.location_ids.length === 1 &&
    fields.location_ids[0] === actor.location_id
  if (!ownOnly) {
    throw new ForbiddenError("Managers can only assign suppliers to their own location")
  }
  return fields
}

async function assertStoreLocations(storeId, locationIds, transaction) {
  if (!locationIds.length) return
  const found = await Location.findAll({
    where: { store_id: storeId, id: { [Op.in]: locationIds }, is_active: true },
    attributes: ["id"],
    transaction,
  })
  if (found.length !== locationIds.length) {
    throw new NotFoundError("One or more locations were not found in this store")
  }
}

async function replaceSupplierLocations(supplier, locationIds, transaction) {
  await SupplierLocation.destroy({ where: { supplier_id: supplier.id }, transaction })
  if (!locationIds.length) return
  await SupplierLocation.bulkCreate(
    locationIds.map((location_id) => ({
      store_id: supplier.store_id,
      supplier_id: supplier.id,
      location_id,
    })),
    { transaction }
  )
}

export async function listSuppliers(storeId, actor = null, query = {}) {
  const locationId = scopedLocationId(actor, query)
  const rows = await Supplier.findAll({
    where: { store_id: storeId },
    include: [SUPPLIER_LOCATIONS_INCLUDE],
    order: [["name", "ASC"]],
  })
  return rows.filter((row) => servesLocation(row, locationId)).map((row) => publicSupplier(row))
}

export async function getSupplier(storeId, id, actor = null) {
  const row = await loadSupplier(storeId, id)
  if (actor?.role === "manager" && !servesLocation(row, actor.location_id)) {
    throw new NotFoundError("Supplier not found")
  }
  return row
}

export async function getSupplierView(storeId, id, actor = null) {
  const row = await getSupplier(storeId, id, actor)
  const balance_owed = await ledgerBalance(storeId, id)
  return publicSupplier(row, { balance_owed })
}

export async function createSupplier(store, input, actor = null) {
  const fields = resolveScopeForActor(actor, input, { creating: true })
  const scope = fields.location_scope || "all"
  const locationIds = scope === "selected" ? fields.location_ids || [] : []

  const id = await sequelize.transaction(async (transaction) => {
    await assertStoreLocations(store.id, locationIds, transaction)
    const row = await Supplier.create(
      {
        store_id: store.id,
        store_id_int: store.store_id_int,
        name: fields.name,
        phone: fields.phone,
        email: fields.email,
        address: fields.address,
        payment_terms: fields.payment_terms,
        location_scope: scope,
        is_active: true,
        is_pos_visible: fields.is_pos_visible,
        is_web_visible: fields.is_web_visible,
        channel: fields.channel,
      },
      { transaction }
    )
    await replaceSupplierLocations(row, locationIds, transaction)
    return row.id
  })
  return publicSupplier(await loadSupplier(store.id, id))
}

export async function updateSupplier(storeId, id, input, actor = null) {
  const row = await getSupplier(storeId, id, actor)
  const { location_ids, ...fields } = resolveScopeForActor(actor, input, { creating: false })

  await sequelize.transaction(async (transaction) => {
    if (fields.location_scope !== undefined) {
      const ids = fields.location_scope === "selected" ? location_ids || [] : []
      await assertStoreLocations(storeId, ids, transaction)
      await replaceSupplierLocations(row, ids, transaction)
    }
    await row.update(fields, { transaction })
  })
  return publicSupplier(await loadSupplier(storeId, id))
}

export async function deactivateSupplier(storeId, id, actor = null) {
  const row = await getSupplier(storeId, id, actor)
  await row.update({ is_active: false })
  return publicSupplier(row)
}

export async function listLedger(storeId, supplierId, actor = null) {
  await getSupplier(storeId, supplierId, actor)
  const where = { store_id: storeId, supplier_id: supplierId }
  if (actor?.role === "manager") where.location_id = actor.location_id
  return SupplierLedger.findAll({
    where,
    order: [["created_at", "DESC"]],
  })
}

export async function addLedgerEntry(store, supplierId, fields, actor) {
  const supplier = await getSupplier(store.id, supplierId, actor)
  if (actor?.role === "manager" && fields.location_id && fields.location_id !== actor.location_id) {
    throw new ForbiddenError("Managers can only record entries for their own location")
  }
  if (fields.location_id) {
    const location = await Location.findOne({
      where: { id: fields.location_id, store_id: store.id },
    })
    if (!location) throw new NotFoundError("Location not found")
    if (!servesLocation(supplier, location.id)) {
      throw new AppError(`${supplier.name} does not supply ${location.name}`, 409)
    }
  }

  return sequelize.transaction(async (transaction) => {
    let stock_movement_id = null
    if (fields.product_id && fields.qty) {
      if (!fields.location_id) {
        throw new AppError("location_id is required when recording stock", 400)
      }
      const product = await getProduct(store.id, fields.product_id)
      const location = await loadLocation(store.id, fields.location_id)
      const delta =
        fields.entry_type === "debit" ? Number(fields.qty) : -Number(fields.qty)
      const { movement } = await applyStockDelta(
        {
          storeId: store.id,
          storeIdInt: store.store_id_int,
          location,
          productId: product.id,
          delta,
          movement_type: delta > 0 ? "stock_in" : "stock_out",
          reason: delta > 0 ? "purchase" : "return_to_supplier",
          reason_note: fields.note,
          staff_id: actor.id,
          supplier_id: supplier.id,
        },
        { transaction }
      )
      stock_movement_id = movement?.id || null
    }

    const entry = await SupplierLedger.create(
      {
        store_id: store.id,
        store_id_int: store.store_id_int,
        location_id: fields.location_id,
        supplier_id: supplier.id,
        entry_type: fields.entry_type,
        amount: fields.amount,
        due_date: fields.due_date,
        paid_at: fields.entry_type === "credit" ? new Date() : null,
        stock_movement_id,
        note: fields.note,
        created_by: actor.id,
        ...copyVisibility(supplier),
      },
      { transaction }
    )

    const balance_owed = await ledgerBalance(store.id, supplier.id, transaction)
    return { entry, balance_owed }
  })
}
