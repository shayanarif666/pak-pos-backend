import { Op } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { Offer } from "./offer.model.js"
import { OfferTarget } from "./offerTarget.model.js"
import { OfferLocation } from "./offerLocation.model.js"
import { Product } from "../catalog/product.model.js"
import { Category } from "../catalog/category.model.js"
import { Location } from "../locations/location.model.js"
import { assertOfferRules } from "./offer.validation.js"
import { nextOfferNumber } from "../../shared/utils/counter.util.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

const targetInclude = { model: OfferTarget }
const locationInclude = {
  model: OfferLocation,
  as: "offerLocations",
  attributes: ["location_id"],
  include: [{ model: Location, attributes: ["id", "location_id_int", "name"] }],
}

const BRANCH_ROLES = new Set(["manager", "cashier"])

function publicTarget(row) {
  const json = row.toJSON ? row.toJSON() : row
  return {
    id: json.id,
    offer_id: json.offer_id,
    product_id: json.product_id,
    category_id: json.category_id,
    free_product_id: json.free_product_id,
    promo_price: json.promo_price == null ? null : Number(json.promo_price),
  }
}

function publicOffer(row) {
  const json = row.toJSON ? row.toJSON() : row
  return {
    id: json.id,
    store_id: json.store_id,
    store_number: json.store_id_int,
    offer_number: json.offer_number,
    name: json.name,
    type: json.type,
    apply_to: json.apply_to,
    // "all" = every location; "selected" = only the locations below.
    location_scope: json.location_scope || "all",
    location_ids: (json.offerLocations || []).map((link) => link.Location?.location_id_int ?? null),
    locations: (json.offerLocations || []).map((link) => ({
      id: link.Location?.location_id_int ?? null,
      name: link.Location?.name || null,
    })),
    discount_type: json.discount_type,
    discount_value:
      json.discount_value == null ? null : Number(json.discount_value),
    min_qty: json.min_qty == null ? null : Number(json.min_qty),
    buy_qty: json.buy_qty,
    get_qty: json.get_qty,
    start_at: json.start_at,
    end_at: json.end_at,
    is_active: json.is_active,
    created_by: json.created_by,
    created_at: json.created_at,
    updated_at: json.updated_at,
    targets: (json.OfferTargets || []).map(publicTarget),
  }
}

/** Managers and cashiers work with their own location only; the store admin may filter. */
function scopedLocationId(actor, query = {}) {
  if (BRANCH_ROLES.has(actor?.role)) return actor.location_id || null
  return query.location_id || query.locationId || null
}

function runsAtLocation(offer, locationId) {
  if (!locationId || offer.location_scope !== "selected") return true
  return (offer.offerLocations || []).some((link) => link.location_id === locationId)
}

function activeWindow(now = new Date()) {
  return {
    is_active: true,
    [Op.and]: [
      { [Op.or]: [{ start_at: null }, { start_at: { [Op.lte]: now } }] },
      { [Op.or]: [{ end_at: null }, { end_at: { [Op.gte]: now } }] },
    ],
  }
}

function assertCanSee(actor, offer) {
  if (BRANCH_ROLES.has(actor.role) && !runsAtLocation(offer, actor.location_id)) {
    throw new NotFoundError("Offer not found")
  }
}

/**
 * Only the store admin chooses where an offer runs (all locations or selected ones). A manager's
 * or cashier's offer is always for the location in their token, and editing it does not move it.
 */
function resolveScopeForActor(actor, fields, { creating }) {
  if (!BRANCH_ROLES.has(actor?.role)) return fields
  if (!actor.location_id) throw new ForbiddenError("Your account has no location")
  const { location_scope: _scope, location_ids: _ids, ...rest } = fields
  return creating
    ? { ...rest, location_scope: "selected", location_ids: [actor.location_id] }
    : rest
}

/**
 * location_ids may hold location numbers (1, 2, 3...) or UUIDs; returns the matching active
 * locations' UUIDs, or 404 when any of them is not a location of this store.
 */
async function resolveStoreLocations(storeId, values, transaction) {
  if (!values.length) return []
  const numbers = values.filter((value) => /^\d+$/.test(value)).map(Number)
  const uuids = values.filter((value) => !/^\d+$/.test(value))
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
  if (values.some((value) => !matched.has(value))) {
    throw new NotFoundError("One or more locations were not found in this store")
  }
  return found.map((row) => row.id)
}

async function replaceOfferLocations(offer, locationIds, transaction) {
  await OfferLocation.destroy({ where: { offer_id: offer.id }, transaction })
  if (!locationIds.length) return
  await OfferLocation.bulkCreate(
    locationIds.map((location_id) => ({
      store_id: offer.store_id,
      offer_id: offer.id,
      location_id,
    })),
    { transaction }
  )
}

export async function listOffers(actor, query = {}) {
  const where = { store_id: actor.store_id }
  const locationId = scopedLocationId(actor, query)
  if (query.type) where.type = query.type
  if (query.pos === "1" || query.active === "1" || actor.role === "cashier") {
    Object.assign(where, activeWindow())
  }

  const rows = await Offer.findAll({
    where,
    include: [targetInclude, locationInclude],
    order: [["created_at", "DESC"]],
  })
  return rows.filter((row) => runsAtLocation(row, locationId)).map(publicOffer)
}

export async function getOffer(storeId, id) {
  const row = await Offer.findOne({
    where: { id, store_id: storeId },
    include: [targetInclude, locationInclude],
  })
  if (!row) throw new NotFoundError("Offer not found")
  return row
}

export async function getOfferView(actor, id) {
  const row = await getOffer(actor.store_id, id)
  assertCanSee(actor, row)
  return publicOffer(row)
}

/** A product/category ref from the request: its short number (e.g. 1) or its UUID. */
async function findByRef(model, numberColumn, storeId, ref, label) {
  const where = { store_id: storeId }
  if (/^\d+$/.test(ref)) where[numberColumn] = Number(ref)
  else where.id = ref
  const row = await model.findOne({ where, attributes: ["id", numberColumn] })
  if (!row) throw new NotFoundError(`${label} not found`)
  return row
}

/** Turns a parsed target's refs into the UUID columns offer_targets stores. */
async function resolveTarget(storeId, offer, target) {
  if (offer.apply_to === "product" && !target.product_ref) {
    throw new AppError("This offer applies to products", 400)
  }
  if (offer.apply_to === "category" && !target.category_ref) {
    throw new AppError("This offer applies to categories", 400)
  }
  const product = target.product_ref
    ? await findByRef(Product, "product_number", storeId, target.product_ref, "Product")
    : null
  const category = target.category_ref
    ? await findByRef(Category, "category_number", storeId, target.category_ref, "Category")
    : null
  const free = target.free_product_ref
    ? await findByRef(Product, "product_number", storeId, target.free_product_ref, "Free product")
    : null
  return {
    product_id: product?.id || null,
    category_id: category?.id || null,
    free_product_id: free?.id || null,
    promo_price: target.promo_price,
    // Not stored — only for the POS create response.
    product_number: product?.product_number ?? null,
    category_number: category?.category_number ?? null,
  }
}

function targetRow(offerId, { product_number, category_number, ...columns }) {
  return { offer_id: offerId, ...columns }
}

/**
 * Creates the offer and its target(s) together. The POS create response is
 * { id: offer_number, type, name, product_id | category_id: that number }.
 */
export async function createOffer(store, input, actor) {
  const fields = resolveScopeForActor(actor, input, { creating: true })
  const scope = fields.location_scope || "all"
  const requested = scope === "selected" ? (fields.location_ids || []).map(String) : []
  const targets = []
  for (const target of fields.targets || []) {
    targets.push(await resolveTarget(store.id, fields, target))
  }

  const row = await sequelize.transaction(async (transaction) => {
    const locationIds = await resolveStoreLocations(store.id, requested, transaction)
    const offer = await Offer.create(
      {
        store_id: store.id,
        store_id_int: store.store_id_int,
        offer_number: await nextOfferNumber(store.id),
        name: fields.name,
        type: fields.type,
        apply_to: fields.apply_to,
        location_scope: scope,
        discount_type: fields.discount_type,
        discount_value: fields.discount_value,
        min_qty: fields.min_qty,
        buy_qty: fields.buy_qty,
        get_qty: fields.get_qty,
        start_at: fields.start_at,
        end_at: fields.end_at,
        is_active: fields.is_active,
        created_by: actor.id,
      },
      { transaction }
    )
    await replaceOfferLocations(offer, locationIds, transaction)
    if (targets.length) {
      await OfferTarget.bulkCreate(
        targets.map((target) => targetRow(offer.id, target)),
        { transaction }
      )
    }
    return offer
  })

  const first = targets[0] || {}
  const summary = {
    id: row.offer_number,
    type: row.type,
    name: row.name,
    ...(row.apply_to === "product"
      ? { product_id: first.product_number ?? null }
      : { category_id: first.category_number ?? null }),
  }
  return { ...publicOffer(await getOffer(store.id, row.id)), summary }
}

export async function updateOffer(actor, id, input) {
  const row = await getOffer(actor.store_id, id)
  assertCanSee(actor, row)
  const { location_ids, ...fields } = resolveScopeForActor(actor, input, { creating: false })
  const patch = { ...fields }
  assertOfferRules({
    type: patch.type ?? row.type,
    apply_to: patch.apply_to ?? row.apply_to,
    discount_type:
      patch.discount_type !== undefined ? patch.discount_type : row.discount_type,
    discount_value:
      patch.discount_value !== undefined
        ? patch.discount_value
        : row.discount_value == null
          ? null
          : Number(row.discount_value),
    min_qty:
      patch.min_qty !== undefined
        ? patch.min_qty
        : row.min_qty == null
          ? null
          : Number(row.min_qty),
    buy_qty: patch.buy_qty !== undefined ? patch.buy_qty : row.buy_qty,
    get_qty: patch.get_qty !== undefined ? patch.get_qty : row.get_qty,
  })
  if (fields.start_at !== undefined || fields.end_at !== undefined) {
    const start_at = fields.start_at !== undefined ? fields.start_at : row.start_at
    const end_at = fields.end_at !== undefined ? fields.end_at : row.end_at
    if (start_at && end_at && new Date(end_at) < new Date(start_at)) {
      throw new AppError("end_at must be on or after start_at", 400)
    }
  }
  await sequelize.transaction(async (transaction) => {
    if (fields.location_scope !== undefined) {
      const requested =
        fields.location_scope === "selected" ? (location_ids || []).map(String) : []
      const ids = await resolveStoreLocations(actor.store_id, requested, transaction)
      await replaceOfferLocations(row, ids, transaction)
    }
    await row.update(patch, { transaction })
  })
  return publicOffer(await getOffer(actor.store_id, id))
}

export async function deactivateOffer(actor, id) {
  const row = await getOffer(actor.store_id, id)
  assertCanSee(actor, row)
  await row.update({ is_active: false })
  return publicOffer(await getOffer(actor.store_id, id))
}

export async function listTargets(actor, offerId) {
  const offer = await getOffer(actor.store_id, offerId)
  assertCanSee(actor, offer)
  return (offer.OfferTargets || []).map(publicTarget)
}

export async function replaceTargets(actor, offerId, targets) {
  const offer = await getOffer(actor.store_id, offerId)
  assertCanSee(actor, offer)
  const resolved = []
  for (const target of targets) resolved.push(await resolveTarget(actor.store_id, offer, target))

  await sequelize.transaction(async (transaction) => {
    await OfferTarget.destroy({ where: { offer_id: offer.id }, transaction })
    if (resolved.length) {
      await OfferTarget.bulkCreate(
        resolved.map((target) => targetRow(offer.id, target)),
        { transaction }
      )
    }
  })
  return listTargets(actor, offerId)
}
