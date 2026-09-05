import { Op, UniqueConstraintError } from "sequelize"
import { Coupon } from "./coupon.model.js"
import { CouponRedemption } from "./couponRedemption.model.js"
import { getLocation } from "../locations/location.service.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

function publicCoupon(row) {
  const json = row.toJSON ? row.toJSON() : row
  return {
    id: json.id,
    store_id: json.store_id,
    location_id: json.location_id,
    code: json.code,
    type: json.type,
    value: Number(json.value),
    min_order_amount: Number(json.min_order_amount),
    start_date: json.start_date,
    end_date: json.end_date,
    usage_limit: json.usage_limit,
    used_count: json.used_count,
    is_active: json.is_active,
    pos_enabled: json.pos_enabled,
    web_enabled: json.web_enabled,
    created_at: json.created_at,
    updated_at: json.updated_at,
  }
}

function locationScope(actor, query = {}) {
  if (actor.role === "store_admin" || actor.role === "customer") {
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

async function resolveLocationId(storeId, actor, locationId) {
  if (!locationId) return null
  if (
    actor.role !== "store_admin" &&
    locationId !== actor.location_id
  ) {
    throw new ForbiddenError("You can only set coupons for your location")
  }
  const location = await getLocation(storeId, locationId)
  return location.id
}

function assertCanSee(actor, coupon) {
  if (actor.role === "store_admin" || actor.role === "customer") return
  if (coupon.location_id && coupon.location_id !== actor.location_id) {
    throw new NotFoundError("Coupon not found")
  }
}

export async function listCoupons(actor, query = {}) {
  const where = { store_id: actor.store_id }
  const loc = locationScope(actor, query)
  if (loc) Object.assign(where, loc)
  if (query.pos === "1" || query.pos === "true" || actor.role === "cashier") {
    where.pos_enabled = true
  }
  if (query.web === "1" || query.web === "true") where.web_enabled = true

  const rows = await Coupon.findAll({
    where,
    order: [["created_at", "DESC"]],
  })
  return rows.map(publicCoupon)
}

export async function getCoupon(storeId, id) {
  const row = await Coupon.findOne({ where: { id, store_id: storeId } })
  if (!row) throw new NotFoundError("Coupon not found")
  return row
}

export async function getCouponView(actor, id) {
  const row = await getCoupon(actor.store_id, id)
  assertCanSee(actor, row)
  return publicCoupon(row)
}

export async function createCoupon(store, fields, actor) {
  const location_id = await resolveLocationId(
    store.id,
    actor,
    fields.location_id
  )
  try {
    const row = await Coupon.create({
      store_id: store.id,
      store_id_int: store.store_id_int,
      location_id,
      code: fields.code,
      type: fields.type,
      value: fields.value,
      min_order_amount: fields.min_order_amount,
      start_date: fields.start_date,
      end_date: fields.end_date,
      usage_limit: fields.usage_limit,
      used_count: 0,
      is_active: fields.is_active,
      pos_enabled: fields.pos_enabled,
      web_enabled: fields.web_enabled,
    })
    return publicCoupon(row)
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new ConflictError("Coupon code already exists for this store")
    }
    throw err
  }
}

export async function updateCoupon(actor, id, fields) {
  const row = await getCoupon(actor.store_id, id)
  assertCanSee(actor, row)
  const patch = { ...fields }
  if (fields.location_id !== undefined) {
    patch.location_id = await resolveLocationId(
      actor.store_id,
      actor,
      fields.location_id
    )
  }
  if (fields.start_date !== undefined || fields.end_date !== undefined) {
    const start_date =
      fields.start_date !== undefined ? fields.start_date : row.start_date
    const end_date = fields.end_date !== undefined ? fields.end_date : row.end_date
    if (start_date && end_date && new Date(end_date) < new Date(start_date)) {
      throw new AppError("end_date must be on or after start_date", 400)
    }
  }
  const type = fields.type ?? row.type
  const value = fields.value !== undefined ? fields.value : Number(row.value)
  if (type === "percentage" && value > 100) {
    throw new AppError("percentage value cannot exceed 100", 400)
  }
  try {
    await row.update(patch)
    return publicCoupon(row)
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new ConflictError("Coupon code already exists for this store")
    }
    throw err
  }
}

export async function listRedemptions(actor, couponId) {
  await getCouponView(actor, couponId)
  return CouponRedemption.findAll({
    where: { store_id: actor.store_id, coupon_id: couponId },
    order: [["created_at", "DESC"]],
  })
}

export function couponBlockReason(coupon, { order_total, channel, location_id, now }) {
  if (!coupon.is_active) return "Coupon is not active"
  if (channel === "pos" && !coupon.pos_enabled) return "Coupon is not enabled for POS"
  if (channel === "web" && !coupon.web_enabled) return "Coupon is not enabled for web"
  if (coupon.location_id && location_id && coupon.location_id !== location_id) {
    return "Coupon is not valid at this location"
  }
  if (coupon.start_date && now < new Date(coupon.start_date)) {
    return "Coupon has not started"
  }
  if (coupon.end_date && now > new Date(coupon.end_date)) {
    return "Coupon has expired"
  }
  if (coupon.usage_limit != null && coupon.used_count >= coupon.usage_limit) {
    return "Coupon usage limit reached"
  }
  if (order_total < Number(coupon.min_order_amount)) {
    return "Order total is below the minimum"
  }
  return null
}

export function computeCouponDiscount(coupon, order_total) {
  const value = Number(coupon.value)
  if (coupon.type === "percentage") {
    return Math.min(order_total, Number(((order_total * value) / 100).toFixed(2)))
  }
  return Math.min(order_total, value)
}

export async function findCouponByCode(storeId, code) {
  if (!code) return null
  return Coupon.findOne({
    where: { store_id: storeId, code: String(code).trim().toUpperCase() },
  })
}

export async function previewCoupon(actor, fields) {
  const location_id =
    fields.location_id ||
    (actor.role === "store_admin" || actor.role === "customer"
      ? null
      : actor.location_id)

  const coupon = await findCouponByCode(actor.store_id, fields.code)
  if (!coupon) {
    return { valid: false, reason: "Coupon not found", discount_amount: 0 }
  }

  const reason = couponBlockReason(coupon, {
    order_total: fields.order_total,
    channel: fields.channel,
    location_id,
    now: new Date(),
  })
  if (reason) {
    return {
      valid: false,
      reason,
      coupon: publicCoupon(coupon),
      discount_amount: 0,
    }
  }

  const discount_amount = computeCouponDiscount(coupon, fields.order_total)
  return {
    valid: true,
    coupon: publicCoupon(coupon),
    discount_amount,
    payable: Number((fields.order_total - discount_amount).toFixed(2)),
  }
}
