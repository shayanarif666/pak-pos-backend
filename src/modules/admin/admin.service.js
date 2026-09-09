import { sequelize } from "../../db/sequelize.js"
import { User } from "../auth/user.model.js"
import { Location } from "../locations/location.model.js"
import { Store } from "../stores/store.model.js"
import { StoreTheme } from "../stores/storeTheme.model.js"
import { WebsiteContent } from "../stores/websiteContent.model.js"
import { ShippingRule } from "../stores/shippingRule.model.js"
import { PaymentMethodTaxRate } from "../stores/paymentMethodTaxRate.model.js"
import { StoreLicense } from "../stores/storeLicense.model.js"
import { Plan } from "../plans/plan.model.js"
import {
  createStore,
  setStoreDefaultLocation,
  setStoreOwner,
} from "../stores/store.service.js"
import { issueLicense } from "../stores/license.service.js"
import { createBilling } from "../billings/billing.service.js"
import { hashPassword } from "../../shared/utils/hash.util.js"
import { ensureUniqueSlug } from "../../shared/utils/slugify.js"
import { ensureSequenceAtLeast } from "../../shared/utils/counter.util.js"
import { issueUserSession } from "../auth/auth.service.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

const DEFAULT_THEME = {
  primary: "#111827",
  secondary: "#6B7280",
  accent: "#2563EB",
  btn_filled_bg: "#2563EB",
  btn_filled_text: "#FFFFFF",
  btn_filled_hover: "#1D4ED8",
  btn_outline_border: "#2563EB",
  btn_outline_text: "#2563EB",
  btn_outline_hover: "#EFF6FF",
  btn_text_color: "#111827",
  btn_text_hover: "#2563EB",
}

const DEFAULT_TAX_RATES = [
  { payment_method: "cash", gst_percent: 16 },
  { payment_method: "card", gst_percent: 5 },
  { payment_method: "jazzcash", gst_percent: 5 },
  { payment_method: "easypaisa", gst_percent: 5 },
]

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    store_id: user.store_id,
    store_number: user.store_id_int,
    location_id: user.location_id,
    location_number: user.location_id_int,
  }
}

function publicStore(store) {
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
    admin_id: store.admin_id,
    default_location_id: store.default_location_id,
    default_location_number: store.default_location_id_int,
    account_manager_name: store.account_manager_name,
    account_manager_phone: store.account_manager_phone,
    is_active: store.is_active,
    is_live: store.is_live,
    suspend_reason: store.suspend_reason,
    pos_enabled: store.pos_enabled,
    web_enabled: store.web_enabled,
    created_at: store.created_at,
  }
}

export async function registerSuperAdmin(input) {
  const email = input.email.toLowerCase()
  const existing = await User.findOne({
    where: { email, role: "superadmin" },
  })
  if (existing) throw new ConflictError("Super Admin email already exists")

  const user = await User.create({
    name: input.name,
    email,
    password: await hashPassword(input.password),
    pin: input.pin,
    role: "superadmin",
    store_id: null,
    store_id_int: null,
    location_id: null,
    location_id_int: null,
    is_verified: true,
    is_active: true,
    refresh_token_hash: null,
  })

  return issueUserSession(user)
}

export async function registerStore(input, superadmin) {
  const slug = await ensureUniqueSlug(input.name, async (candidate) => {
    const taken = await Store.findOne({ where: { slug: candidate } })
    return Boolean(taken)
  })
  if (!slug) throw new AppError("Store name must contain letters or numbers for a slug", 400)

  return sequelize.transaction(async (transaction) => {
    const plan = await Plan.findByPk(input.plan_id, { transaction })
    if (!plan || !plan.is_active) throw new NotFoundError("Plan not found")
    if (plan.max_locations < 1) {
      throw new AppError("Plan does not allow any locations", 400)
    }

    const slugTaken = await Store.findOne({ where: { slug }, transaction })
    if (slugTaken) throw new ConflictError("Store slug already exists")

    const store = await createStore(
      {
        plan_id: plan.id,
        name: input.name,
        slug,
        legal_name: input.legal_name,
        owner_name: input.owner_name,
        business_type: input.business_type,
        address: input.address,
        city: input.city,
        contact_email: input.contact_email,
        contact_phone: input.contact_phone,
        logo_url: input.logo_url,
        favicon_url: input.favicon_url,
        pos_enabled: input.pos_enabled,
        web_enabled: input.web_enabled,
        is_active: true,
        is_live: false,
      },
      { transaction }
    )

    const location = await Location.create(
      {
        store_id: store.id,
        store_id_int: store.store_id_int,
        location_id_int: 1,
        name: input.location_name,
        address_line: input.location_address || input.address,
        city: input.location_city || input.city || "N/A",
        phone: input.location_phone,
        is_default: true,
        is_active: true,
      },
      { transaction }
    )
    await ensureSequenceAtLeast(`location:${store.id}`, 1, transaction)
    await setStoreDefaultLocation(store.id, location, { transaction })

    const admin = await User.create(
      {
        store_id: store.id,
        store_id_int: store.store_id_int,
        location_id: null,
        location_id_int: null,
        name: input.admin_name,
        email: input.admin_email,
        password: await hashPassword(input.admin_password),
        pin: input.admin_pin,
        phone: input.admin_phone,
        role: "store_admin",
        is_verified: true,
        is_active: true,
      },
      { transaction }
    )
    await setStoreOwner(store.id, admin.id, { transaction })

    const manager = await User.create(
      {
        store_id: store.id,
        store_id_int: store.store_id_int,
        location_id: location.id,
        location_id_int: location.location_id_int,
        name: input.manager_name,
        email: input.manager_email,
        password: await hashPassword(input.manager_password),
        pin: input.manager_pin,
        phone: input.manager_phone,
        role: "manager",
        is_verified: true,
        is_active: true,
      },
      { transaction }
    )

    const startsAt = store.created_at || new Date()
    const license = await issueLicense(store, plan, startsAt, { transaction })

    await StoreTheme.create(
      {
        store_id: store.id,
        store_id_int: store.store_id_int,
        ...DEFAULT_THEME,
      },
      { transaction }
    )
    await WebsiteContent.create(
      { store_id: store.id, store_id_int: store.store_id_int },
      { transaction }
    )
    await ShippingRule.create(
      { store_id: store.id, store_id_int: store.store_id_int, flat_fee: 0 },
      { transaction }
    )
    await PaymentMethodTaxRate.bulkCreate(
      DEFAULT_TAX_RATES.map((row) => ({
        store_id: store.id,
        store_id_int: store.store_id_int,
        ...row,
      })),
      { transaction }
    )

    const billing = await createBilling(
      {
        store_id: store.id,
        plan_id: plan.id,
        amount: input.amount,
        status: input.billing_status,
        period_start: license.starts_at,
        period_end: license.expires_at,
        method_note: input.method_note,
        note: input.billing_note,
      },
      { transaction, createdBy: superadmin.id }
    )

    await store.reload({ transaction })

    return {
      store: publicStore(store),
      location: {
        id: location.id,
        location_number: location.location_id_int,
        name: location.name,
        phone: location.phone,
      },
      admin: publicUser(admin),
      manager: publicUser(manager),
      license: {
        id: license.id,
        license_key: license.license_key,
        status: license.status,
        starts_at: license.starts_at,
        expires_at: license.expires_at,
      },
      billing,
      plan: {
        id: plan.id,
        code: plan.code,
        name: plan.name,
        max_devices: plan.max_devices,
        max_locations: plan.max_locations,
      },
    }
  })
}

export async function listStores() {
  const rows = await Store.findAll({
    include: [
      { model: Plan, attributes: ["id", "code", "name", "price_pkr"] },
      {
        model: StoreLicense,
        separate: true,
        limit: 1,
        order: [["created_at", "DESC"]],
      },
    ],
    order: [["created_at", "DESC"]],
  })

  return rows.map((store) => ({
    ...publicStore(store),
    plan: store.Plan
      ? {
          id: store.Plan.id,
          code: store.Plan.code,
          name: store.Plan.name,
          price_pkr: store.Plan.price_pkr,
        }
      : null,
    license: store.StoreLicenses?.[0]
      ? {
          id: store.StoreLicenses[0].id,
          license_key: store.StoreLicenses[0].license_key,
          status: store.StoreLicenses[0].status,
          expires_at: store.StoreLicenses[0].expires_at,
        }
      : null,
  }))
}

export async function getStore(id) {
  const store = await Store.findByPk(id, {
    include: [
      { model: Plan },
      { model: StoreLicense },
      { model: Location },
    ],
  })
  if (!store) throw new NotFoundError("Store not found")

  return {
    ...publicStore(store),
    plan: store.Plan,
    licenses: store.StoreLicenses,
    locations: store.Locations,
  }
}

export async function patchStore(id, fields) {
  const store = await Store.findByPk(id)
  if (!store) throw new NotFoundError("Store not found")
  await store.update(fields)
  return publicStore(store)
}

