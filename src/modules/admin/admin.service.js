import { sequelize } from "../../db/sequelize.js"
import { Op } from "sequelize"
import { User } from "../auth/user.model.js"
import { Location } from "../locations/location.model.js"
import { Store } from "../stores/store.model.js"
import { StoreTheme } from "../stores/storeTheme.model.js"
import { WebsiteContent } from "../stores/websiteContent.model.js"
import { ShippingRule } from "../stores/shippingRule.model.js"
import { PaymentMethodTaxRate } from "../stores/paymentMethodTaxRate.model.js"
import { StoreLicense } from "../stores/storeLicense.model.js"
import { Plan } from "../plans/plan.model.js"
import { Billing } from "../billings/billing.model.js"
import { PosDevice } from "../pos/posDevice.model.js"
import {
  createStore,
  publicStore as publicStoreView,
  setStoreDefaultLocation,
  setStoreOwner,
} from "../stores/store.service.js"
import { publicPlan } from "../plans/plan.service.js"
import { issueLicense, publicLicense } from "../stores/license.service.js"
import { createBilling, publicBilling } from "../billings/billing.service.js"
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

function publicUser(user, locationName = null) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    pin: user.pin || null,
    role: user.role,
    is_active: user.is_active,
    store_id: user.store_id,
    store_number: user.store_id_int,
    location_id: user.location_id,
    location_number: user.location_id_int,
    location_name: locationName,
  }
}

function publicLocation(row) {
  if (!row) return null
  return {
    id: row.id,
    store_id: row.store_id,
    location_number: row.location_id_int,
    name: row.name,
    address_line: row.address_line,
    city: row.city,
    country: row.country,
    postal_code: row.postal_code,
    phone: row.phone,
    is_default: row.is_default,
    is_active: row.is_active,
  }
}

function publicDevice(row) {
  if (!row) return null
  return {
    id: row.id,
    store_id: row.store_id,
    location_id: row.location_id,
    location_number: row.location_id_int,
    device_uid: row.device_uid,
    name: row.name,
    platform: row.platform,
    app_version: row.app_version,
    last_seen_at: row.last_seen_at,
    is_active: row.is_active,
  }
}

function publicStore(store) {
  return publicStoreView(store)
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
        custom_domain: input.custom_domain,
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
  const store = await Store.findByPk(id, { include: [{ model: Plan }] })
  if (!store) throw new NotFoundError("Store not found")

  const [licenseRows, locationRows, billingRows, staffRows, devices] = await Promise.all([
    StoreLicense.findAll({ where: { store_id: store.id }, order: [["created_at", "DESC"]] }),
    Location.findAll({
      where: { store_id: store.id },
      order: [
        ["is_default", "DESC"],
        ["location_id_int", "ASC"],
      ],
    }),
    Billing.findAll({ where: { store_id: store.id }, order: [["created_at", "DESC"]] }),
    User.findAll({
      where: { store_id: store.id },
      order: [["created_at", "ASC"]],
    }),
    PosDevice.findAll({
      where: { store_id: store.id },
      order: [["created_at", "ASC"]],
    }),
  ])

  const locationNameById = new Map(locationRows.map((row) => [row.id, row.name]))
  const staff = staffRows.map((user) =>
    publicUser(user, user.location_id ? locationNameById.get(user.location_id) || null : null)
  )
  const admin =
    staff.find((user) => user.role === "store_admin") ||
    staff.find((user) => user.id === store.admin_id) ||
    null
  const managers = staff.filter((user) => user.role === "manager")
  const cashiers = staff.filter((user) => user.role === "cashier")
  const deviceViews = devices.map(publicDevice)

  const locations = locationRows.map((location) => {
    const locationManagers = managers.filter((user) => user.location_id === location.id)
    const locationCashiers = cashiers.filter((user) => user.location_id === location.id)
    const locationDevices = deviceViews.filter((device) => device.location_id === location.id)
    return {
      ...publicLocation(location),
      manager_count: locationManagers.length,
      cashier_count: locationCashiers.length,
      device_count: locationDevices.length,
      managers: locationManagers,
      cashiers: locationCashiers,
      devices: locationDevices,
    }
  })

  const licenses = licenseRows.map((row) => publicLicense(row))
  const usedLicenses = licenses.filter(
    (row) => row.status === "active" || row.status === "pending"
  )
  const latestLicense = licenses[0] || null
  const kpis = {
    locations: locations.length,
    devices: deviceViews.length,
    licenses: licenses.length,
    licenses_used: usedLicenses.length,
    managers: managers.length,
    cashiers: cashiers.length,
  }

  return {
    ...publicStore(store),
    plan: publicPlan(store.Plan),
    licenses,
    locations,
    devices: deviceViews,
    billings: billingRows.map(publicBilling),
    admin,
    store_admin: admin,
    managers,
    kpis,
    totals: kpis,
    license_expires_at: latestLicense?.expires_at || null,
    cashiers,
  }
}

const STORE_FIELD_KEYS = [
  "plan_id",
  "name",
  "legal_name",
  "owner_name",
  "business_type",
  "address",
  "city",
  "contact_email",
  "contact_phone",
  "logo_url",
  "favicon_url",
  "custom_domain",
  "pos_enabled",
  "web_enabled",
  "is_active",
  "is_live",
  "suspend_reason",
  "account_manager_name",
  "account_manager_phone",
]

async function assertUniqueStaffEmail({ storeId, email, excludeId, transaction }) {
  if (!email) return
  const existing = await User.findOne({
    where: {
      store_id: storeId,
      email,
      ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
    },
    transaction,
  })
  if (existing) throw new ConflictError("Email is already used in this store")
}

export async function patchStore(id, fields) {
  await sequelize.transaction(async (transaction) => {
    const store = await Store.findByPk(id, { transaction })
    if (!store) throw new NotFoundError("Store not found")

    if (fields.plan_id) {
      const plan = await Plan.findByPk(fields.plan_id, { transaction })
      if (!plan) throw new NotFoundError("Plan not found")
    }

    const storePatch = {}
    for (const key of STORE_FIELD_KEYS) {
      if (fields[key] !== undefined) storePatch[key] = fields[key]
    }
    if (Object.keys(storePatch).length) {
      await store.update(storePatch, { transaction })
    }

    const locationTouched = [
      "location_name",
      "location_address",
      "location_city",
      "location_phone",
    ].some((key) => fields[key] !== undefined)

    let location = null
    if (store.default_location_id) {
      location = await Location.findByPk(store.default_location_id, { transaction })
    }
    if (!location) {
      location = await Location.findOne({
        where: { store_id: store.id },
        order: [
          ["is_default", "DESC"],
          ["location_id_int", "ASC"],
        ],
        transaction,
      })
    }
    if (locationTouched) {
      if (!location) throw new NotFoundError("Location not found")
      await location.update(
        {
          ...(fields.location_name !== undefined ? { name: fields.location_name } : {}),
          ...(fields.location_address !== undefined
            ? { address_line: fields.location_address || store.address }
            : {}),
          ...(fields.location_city !== undefined
            ? { city: fields.location_city || store.city || location.city }
            : {}),
          ...(fields.location_phone !== undefined
            ? { phone: fields.location_phone || store.contact_phone }
            : {}),
        },
        { transaction }
      )
    }

    const admin =
      (store.admin_id && (await User.findByPk(store.admin_id, { transaction }))) ||
      (await User.findOne({
        where: { store_id: store.id, role: "store_admin" },
        transaction,
      }))
    const manager = await User.findOne({
      where: { store_id: store.id, role: "manager" },
      order: [["created_at", "ASC"]],
      transaction,
    })

    const nextAdminEmail = fields.admin_email ?? admin?.email
    const nextManagerEmail = fields.manager_email ?? manager?.email
    if (nextAdminEmail && nextManagerEmail && nextAdminEmail === nextManagerEmail) {
      throw new AppError("admin_email and manager_email must be different", 400)
    }
    const nextAdminPin = fields.admin_pin ?? admin?.pin
    const nextManagerPin = fields.manager_pin ?? manager?.pin
    if (nextAdminPin && nextManagerPin && nextAdminPin === nextManagerPin) {
      throw new AppError("admin_pin and manager_pin must be different", 400)
    }

    if (admin) {
      await assertUniqueStaffEmail({
        storeId: store.id,
        email: fields.admin_email,
        excludeId: admin.id,
        transaction,
      })
      const adminPatch = {}
      if (fields.admin_name !== undefined) adminPatch.name = fields.admin_name
      if (fields.admin_email !== undefined) adminPatch.email = fields.admin_email
      if (fields.admin_phone !== undefined) adminPatch.phone = fields.admin_phone
      if (fields.admin_pin !== undefined) adminPatch.pin = fields.admin_pin
      if (fields.admin_password) adminPatch.password = await hashPassword(fields.admin_password)
      if (Object.keys(adminPatch).length) await admin.update(adminPatch, { transaction })
    }

    if (manager) {
      await assertUniqueStaffEmail({
        storeId: store.id,
        email: fields.manager_email,
        excludeId: manager.id,
        transaction,
      })
      const managerPatch = {}
      if (fields.manager_name !== undefined) managerPatch.name = fields.manager_name
      if (fields.manager_email !== undefined) managerPatch.email = fields.manager_email
      if (fields.manager_phone !== undefined) managerPatch.phone = fields.manager_phone
      if (fields.manager_pin !== undefined) managerPatch.pin = fields.manager_pin
      if (fields.manager_password) {
        managerPatch.password = await hashPassword(fields.manager_password)
      }
      if (Object.keys(managerPatch).length) await manager.update(managerPatch, { transaction })
    }

    const billingTouched = ["billing_status", "amount", "method_note", "billing_note"].some(
      (key) => fields[key] !== undefined
    )
    if (billingTouched) {
      const latest = await Billing.findOne({
        where: { store_id: store.id },
        order: [["created_at", "DESC"]],
        transaction,
      })
      if (latest) {
        const billingPatch = {}
        if (fields.billing_status !== undefined) {
          billingPatch.status = fields.billing_status
          if (fields.billing_status === "paid" && !latest.paid_at) {
            billingPatch.paid_at = new Date()
          }
        }
        if (fields.amount !== undefined) billingPatch.amount = fields.amount
        if (fields.method_note !== undefined) billingPatch.method_note = fields.method_note
        if (fields.billing_note !== undefined) billingPatch.note = fields.billing_note
        if (fields.plan_id !== undefined) billingPatch.plan_id = fields.plan_id
        await latest.update(billingPatch, { transaction })
      } else {
        await createBilling(
          {
            store_id: store.id,
            plan_id: fields.plan_id || store.plan_id,
            amount: fields.amount,
            status: fields.billing_status || "pending",
            period_start: new Date(),
            period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            method_note: fields.method_note,
            note: fields.billing_note,
          },
          { transaction }
        )
      }
    }
  })

  return getStore(id)
}

