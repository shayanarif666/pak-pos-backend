import { Op } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { Supplier } from "./supplier.model.js"
import { SupplierLocation } from "./supplierLocation.model.js"
import { Location } from "../locations/location.model.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import { nextSupplierNumber } from "../../shared/utils/counter.util.js"

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
    supplier_number: row.supplier_number,
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
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...extras,
  }
}

const BRANCH_ROLES = new Set(["manager", "cashier"])

/** Managers and cashiers work with their own branch only; store admins see every branch. */
function scopedLocationId(actor, query = {}) {
  if (BRANCH_ROLES.has(actor?.role)) return actor.location_id || null
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
 * Only the store admin chooses where a supplier delivers (all locations or selected ones).
 * A manager or cashier never sends locations: whatever the body says, their supplier is for
 * the store and location in their token, and editing it does not move it.
 */
function resolveScopeForActor(actor, fields, { creating }) {
  if (!BRANCH_ROLES.has(actor?.role)) return fields
  if (!actor.location_id) throw new ForbiddenError("Your account has no location")
  const { location_scope: _scope, location_ids: _ids, ...rest } = fields
  return creating
    ? { ...rest, location_scope: "selected", location_ids: [actor.location_id] }
    : rest
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
    locationIds.map((location_id, idx) => ({
      store_id: supplier.store_id,
      supplier_location_number: idx + 1,
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
  if (BRANCH_ROLES.has(actor?.role) && !servesLocation(row, actor.location_id)) {
    throw new NotFoundError("Supplier not found")
  }
  return row
}

export async function getSupplierView(storeId, id, actor = null) {
  return publicSupplier(await getSupplier(storeId, id, actor))
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
        supplier_number: await nextSupplierNumber(store.id, transaction),
        name: fields.name,
        phone: fields.phone,
        email: fields.email,
        address: fields.address,
        payment_terms: fields.payment_terms,
        location_scope: scope,
        is_active: true,
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
