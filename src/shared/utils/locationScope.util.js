import { Op } from "sequelize"
import { Location } from "../../modules/locations/location.model.js"
import { SUPPLIER_LOCATION_SCOPE } from "../../db/enums.js"
import { AppError } from "../errors/AppError.js"
import { ForbiddenError } from "../errors/ForbiddenError.js"
import { NotFoundError } from "../errors/NotFoundError.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const BRANCH_ROLES = new Set(["manager", "cashier"])

/**
 * Where a row (category / product) is sold, from the request body:
 * - location_scope "all"                          -> every location (location_ids ignored)
 * - location_scope "selected" + location_ids [..] -> one location or several
 * Sending only location_ids implies "selected". Nothing sent = {} (create defaults to "all",
 * a patch leaves the current locations as they are).
 */
export function parseLocationScope(body) {
  const hasScope = body.location_scope !== undefined && body.location_scope !== null
  const hasIds = body.location_ids !== undefined && body.location_ids !== null
  if (!hasScope && !hasIds) return {}

  let ids = []
  if (hasIds) {
    if (!Array.isArray(body.location_ids)) {
      throw new AppError("location_ids must be an array of location ids", 400)
    }
    // Location numbers (1, 2, 3 — what the POS uses) or location UUIDs (the dashboard).
    ids = [...new Set(body.location_ids.map((value) => String(value).trim()))]
    for (const id of ids) {
      if (!/^[1-9]\d*$/.test(id) && !UUID_RE.test(id)) {
        throw new AppError("location_ids must contain location numbers (1, 2, 3...) or UUIDs", 400)
      }
    }
  }

  const scope = hasScope ? String(body.location_scope) : ids.length ? "selected" : "all"
  if (!SUPPLIER_LOCATION_SCOPE.includes(scope)) {
    throw new AppError("location_scope must be all or selected", 400)
  }
  if (scope === "selected" && !ids.length) {
    throw new AppError("location_ids is required when location_scope is selected", 400)
  }
  return { location_scope: scope, location_ids: scope === "selected" ? ids : [] }
}

/**
 * Only the store admin chooses the locations. A manager or cashier never sends them: what they
 * create is for the location in their token, and editing it does not move it.
 */
export function scopeForActor(actor, fields, { creating }) {
  if (!BRANCH_ROLES.has(actor?.role)) return fields
  if (!actor.location_id) throw new ForbiddenError("Your account has no location")
  const { location_scope: _scope, location_ids: _ids, ...rest } = fields
  return creating ? { ...rest, location_scope: "selected", location_ids: [actor.location_id] } : rest
}

/**
 * location_ids may hold location numbers (1, 2, 3...) or UUIDs; returns the matching active
 * locations' UUIDs, or 404 when any of them is not a location of this store.
 */
export async function resolveStoreLocations(storeId, values, transaction) {
  if (!values?.length) return []
  const list = values.map(String)
  const numbers = list.filter((value) => /^\d+$/.test(value)).map(Number)
  const uuids = list.filter((value) => !/^\d+$/.test(value))
  const or = []
  if (numbers.length) or.push({ location_id_int: { [Op.in]: numbers } })
  if (uuids.length) or.push({ id: { [Op.in]: uuids } })
  const found = await Location.findAll({
    where: { store_id: storeId, is_active: true, [Op.or]: or },
    attributes: ["id", "location_id_int"],
    order: [["location_id_int", "ASC"]],
    transaction,
  })
  const matched = new Set(found.flatMap((row) => [row.id, String(row.location_id_int)]))
  if (list.some((value) => !matched.has(value))) {
    throw new NotFoundError("One or more locations were not found in this store")
  }
  return found.map((row) => row.id)
}

/** Replaces a row's location links (model = CategoryLocation / ProductLocation). */
export async function replaceLocationLinks(model, fk, row, locationIds, transaction) {
  await model.destroy({ where: { [fk]: row.id }, transaction })
  if (!locationIds.length) return
  await model.bulkCreate(
    locationIds.map((location_id) => ({ store_id: row.store_id, [fk]: row.id, location_id })),
    { transaction }
  )
}

/** Whether a row with these links is sold at locationId (no location = every row). */
export function soldAt(row, links, locationId) {
  if (!locationId || (row?.location_scope || "all") !== "selected") return true
  return (links || []).some((link) => link.location_id === locationId)
}

/** location_scope / location_ids / locations for a reply. */
export function locationScopeView(row, links) {
  const list = links || []
  return {
    location_scope: row.location_scope || "all",
    location_ids: list.map((link) => link.location_id),
    locations: list.map((link) => ({
      id: link.location_id,
      location_number: link.Location?.location_id_int ?? null,
      name: link.Location?.name || null,
    })),
  }
}
