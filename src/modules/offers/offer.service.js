import { Op } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { Offer } from "./offer.model.js"
import { OfferTarget } from "./offerTarget.model.js"
import { getProduct } from "../catalog/product.service.js"
import { getCategory } from "../catalog/category.service.js"
import { getLocation } from "../locations/location.service.js"
import { assertOfferRules } from "./offer.validation.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

const targetInclude = { model: OfferTarget }

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
    location_id: json.location_id,
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
    include: [targetInclude],
    order: [["created_at", "DESC"]],
  })
  return rows.map(publicOffer)
}

export async function getOffer(storeId, id) {
  const row = await Offer.findOne({
    where: { id, store_id: storeId },
    include: [targetInclude],
  })
  if (!row) throw new NotFoundError("Offer not found")
  return row
}

export async function getOfferView(actor, id) {
  const row = await getOffer(actor.store_id, id)
  assertCanSee(actor, row)
  return publicOffer(row)
}

export async function createOffer(store, fields, actor) {
  const location_id = await resolveLocationId(
    store.id,
    actor,
    fields.location_id
  )
  const row = await Offer.create({
    store_id: store.id,
    store_id_int: store.store_id_int,
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
  })
  return publicOffer(await getOffer(store.id, row.id))
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

async function assertTargetsMatchOffer(storeId, offer, targets) {
  for (const target of targets) {
    if (offer.apply_to === "product" && !target.product_id) {
      throw new AppError("This offer applies to products", 400)
    }
    if (offer.apply_to === "category" && !target.category_id) {
      throw new AppError("This offer applies to categories", 400)
    }
    if (target.product_id) await getProduct(storeId, target.product_id)
    if (target.category_id) await getCategory(storeId, target.category_id)
    if (target.free_product_id) await getProduct(storeId, target.free_product_id)
  }
}

export async function listTargets(actor, offerId) {
  const offer = await getOffer(actor.store_id, offerId)
  assertCanSee(actor, offer)
  return (offer.OfferTargets || []).map(publicTarget)
}

export async function replaceTargets(actor, offerId, targets) {
  const offer = await getOffer(actor.store_id, offerId)
  assertCanSee(actor, offer)
  await assertTargetsMatchOffer(actor.store_id, offer, targets)

  await sequelize.transaction(async (transaction) => {
    await OfferTarget.destroy({ where: { offer_id: offer.id }, transaction })
    if (targets.length) {
      await OfferTarget.bulkCreate(
        targets.map((target) => ({ offer_id: offer.id, ...target })),
        { transaction }
      )
    }
  })
  return listTargets(actor, offerId)
}
