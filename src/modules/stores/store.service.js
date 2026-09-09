import { UniqueConstraintError } from "sequelize"
import { Store } from "./store.model.js"
import { StoreTheme } from "./storeTheme.model.js"
import { WebsiteContent } from "./websiteContent.model.js"
import { ShippingRule } from "./shippingRule.model.js"
import { Plan } from "../plans/plan.model.js"
import { publicPlan } from "../plans/plan.service.js"
import { nextStoreID } from "../../shared/utils/counter.util.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { AppError } from "../../shared/errors/AppError.js"

export async function createStore(fields, { transaction }) {
  const existing = await Store.findOne({
    where: { slug: fields.slug },
    transaction,
  })
  if (existing) {
    throw new ConflictError("Store slug already exists")
  }

  const payload = { ...fields }
  if (payload.store_id_int == null) {
    payload.store_id_int = await nextStoreID(transaction)
  }

  try {
    return await Store.create(payload, { transaction })
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new ConflictError("Store slug already exists")
    }
    throw err
  }
}

export async function setStoreOwner(storeId, ownerId, { transaction }) {
  await Store.update({ admin_id: ownerId }, { where: { id: storeId }, transaction })
}

export async function setStoreDefaultLocation(storeId, location, { transaction }) {
  await Store.update(
    {
      default_location_id: location.id,
      default_location_id_int: location.location_id_int,
    },
    { where: { id: storeId }, transaction }
  )
}

export async function findLiveStoreBySlug(slug) {
  return Store.findOne({
    where: { slug, is_live: true, is_active: true },
  })
}

const STORE_PATCH_FIELDS = [
  "name",
  "legal_name",
  "owner_name",
  "address",
  "city",
  "contact_email",
  "contact_phone",
  "logo_url",
  "favicon_url",
  "currency",
  "timezone",
  "ntn",
  "strn",
  "fbr_invoice_enabled",
  "charge_tax_on_sales",
  "default_tax_rate",
  "expiry_warning_days",
  "expiry_critical_days",
  "receipt_footer",
  "pos_enabled",
  "web_enabled",
  "is_live",
]

function publicPlanLimits(plan) {
  if (!plan) return null
  const view = publicPlan(plan)
  return {
    id: view.id,
    code: view.code,
    name: view.name,
    max_devices: view.max_devices,
    max_locations: view.max_locations,
    features: view.features,
  }
}

export function publicStore(store) {
  if (!store) return null
  return {
    id: store.id,
    store_number: store.store_id_int,
    plan_id: store.plan_id,
    name: store.name,
    slug: store.slug,
    legal_name: store.legal_name,
    owner_name: store.owner_name,
    business_type: store.business_type,
    address: store.address,
    city: store.city,
    contact_email: store.contact_email,
    contact_phone: store.contact_phone,
    logo_url: store.logo_url,
    favicon_url: store.favicon_url,
    currency: store.currency,
    timezone: store.timezone,
    ntn: store.ntn,
    strn: store.strn,
    fbr_invoice_enabled: store.fbr_invoice_enabled,
    charge_tax_on_sales: store.charge_tax_on_sales,
    default_tax_rate: store.default_tax_rate,
    expiry_warning_days: store.expiry_warning_days,
    expiry_critical_days: store.expiry_critical_days,
    receipt_footer: store.receipt_footer,
    admin_id: store.admin_id,
    default_location_id: store.default_location_id,
    default_location_number: store.default_location_id_int,
    location_id: store.default_location_id,
    location_number: store.default_location_id_int,
    pos_enabled: store.pos_enabled,
    web_enabled: store.web_enabled,
    is_live: store.is_live,
    is_active: store.is_active,
  }
}

export async function getStoreForManager(storeId) {
  const store = await Store.findByPk(storeId)
  if (!store) throw new NotFoundError("Store not found")
  return store
}

export async function getStorePlan(store) {
  const plan = await Plan.findByPk(store.plan_id)
  if (!plan) throw new NotFoundError("Plan not found")
  return plan
}

export async function getMyStoreView(storeId) {
  const store = await getStoreForManager(storeId)
  const plan = await getStorePlan(store)
  return { ...publicStore(store), plan: publicPlanLimits(plan) }
}

export async function resolveStore(storeId) {
  if (!storeId) throw new AppError("storeId is required", 400)
  const store = await Store.findByPk(storeId)
  if (!store) throw new NotFoundError("Store not found")
  return {
    store_id: store.id,
    store_id_int: store.store_id_int,
  }
}

export async function updateStoreForManager(storeId, fields) {
  const store = await getStoreForManager(storeId)
  const patch = {}
  for (const key of STORE_PATCH_FIELDS) {
    if (fields[key] !== undefined) patch[key] = fields[key]
  }
  await store.update(patch)
  return publicStore(store)
}

export async function getTheme(storeId) {
  return StoreTheme.findOne({ where: { store_id: storeId } })
}

export async function upsertTheme(store, fields) {
  const existing = await getTheme(store.id)
  if (existing) {
    await existing.update(fields)
    return existing
  }
  return StoreTheme.create({
    store_id: store.id,
    store_id_int: store.store_id_int,
    ...fields,
  })
}

export async function getContent(storeId) {
  return WebsiteContent.findOne({ where: { store_id: storeId } })
}

export async function upsertContent(store, fields) {
  const existing = await getContent(store.id)
  if (existing) {
    await existing.update(fields)
    return existing
  }
  return WebsiteContent.create({
    store_id: store.id,
    store_id_int: store.store_id_int,
    ...fields,
  })
}

export async function getShipping(storeId) {
  return ShippingRule.findOne({ where: { store_id: storeId } })
}

export async function upsertShipping(store, fields) {
  const existing = await getShipping(store.id)
  if (existing) {
    await existing.update(fields)
    return existing
  }
  return ShippingRule.create({
    store_id: store.id,
    store_id_int: store.store_id_int,
    ...fields,
  })
}

export async function getPublicStoreBySlug(slug) {
  const store = await findLiveStoreBySlug(slug)
  if (!store) throw new NotFoundError("Store not found")

  const [theme, content, shipping] = await Promise.all([
    getTheme(store.id),
    getContent(store.id),
    getShipping(store.id),
  ])

  return {
    store: publicStore(store),
    theme,
    content,
    shipping,
  }
}
