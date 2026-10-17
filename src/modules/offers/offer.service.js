import { Op } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { Offer } from "./offer.model.js"
import { OfferTarget } from "./offerTarget.model.js"
import { Product } from "../catalog/product.model.js"
import { Category } from "../catalog/category.model.js"
import { getLocation } from "../locations/location.service.js"
import { Location } from "../locations/location.model.js"
import { assertOfferRules } from "./offer.validation.js"
import { nextOfferNumber } from "../../shared/utils/counter.util.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

const targetInclude = { model: OfferTarget }
const locationInclude = {
  model: Location,
  attributes: ["id", "name", "location_id_int"],
}

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
    location_id: json.location_id,
    location_number: json.Location?.location_id_int ?? null,
    name: json.name,
    type: json.type,
    apply_to: json.apply_to,
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

function locationScope(actor, query = {}) {
  if (actor.role === "store_admin") {
    const locationId = query.locationId || query.location_id
    if (!locationId) return null
    return {
      [Op.or]: [{ location_id: null }, { location_id: locationId }],
    }
  }
  return {
    [Op.or]: [{ location_id: null }, { location_id: actor.location_id }],
  }
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

async function resolveLocationId(storeId, actor, locationId) {
  if (!locationId) return null
  if (
    actor.role !== "store_admin" &&
    locationId !== actor.location_id
  ) {
    throw new ForbiddenError("You can only set offers for your location")
  }
  const location = await getLocation(storeId, locationId)
  return location.id
}

function assertCanSee(actor, offer) {
  if (actor.role === "store_admin") return
  if (offer.location_id && offer.location_id !== actor.location_id) {
    throw new NotFoundError("Offer not found")
  }
}

export async function listOffers(actor, query = {}) {
  const where = { store_id: actor.store_id }
  const loc = locationScope(actor, query)
  if (loc) Object.assign(where, loc)
  if (query.type) where.type = query.type
  if (query.pos === "1" || query.active === "1" || actor.role === "cashier") {
    Object.assign(where, activeWindow())
  }

  const rows = await Offer.findAll({
    where,
    include: [targetInclude, locationInclude],
    order: [["created_at", "DESC"]],
  })
  return rows.map(publicOffer)
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
export async function createOffer(store, fields, actor) {
  const location_id = await resolveLocationId(
    store.id,
    actor,
    fields.location_id
  )
  const targets = []
  for (const target of fields.targets || []) {
    targets.push(await resolveTarget(store.id, fields, target))
  }

  const row = await sequelize.transaction(async (transaction) => {
    const offer = await Offer.create(
      {
        store_id: store.id,
        store_id_int: store.store_id_int,
        offer_number: await nextOfferNumber(store.id),
        location_id,
        name: fields.name,
        type: fields.type,
        apply_to: fields.apply_to,
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

export async function updateOffer(actor, id, fields) {
  const row = await getOffer(actor.store_id, id)
  assertCanSee(actor, row)
  const patch = { ...fields }
  if (fields.location_id !== undefined) {
    patch.location_id = await resolveLocationId(
      actor.store_id,
      actor,
      fields.location_id
    )
  }
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
  await row.update(patch)
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
