import crypto from "crypto"
import { StoreLicense } from "./storeLicense.model.js"
import { Store } from "./store.model.js"
import { Plan } from "../plans/plan.model.js"
import { User } from "../auth/user.model.js"
import { PosDevice } from "../pos/posDevice.model.js"
import { Location } from "../locations/location.model.js"
import { addOneMonth, isExpired } from "../../shared/utils/date.util.js"
import { comparePassword } from "../../shared/utils/hash.util.js"
import { writeAudit } from "../../shared/utils/audit.util.js"
import { assertPlan } from "../../shared/utils/plan.util.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import { UnauthorizedError } from "../../shared/errors/UnauthorizedError.js"

const ACTIVATOR_ROLES = new Set(["store_admin", "manager"])

export function generateLicenseKey() {
  const raw = crypto.randomBytes(8).toString("hex").toUpperCase()
  return `LIC-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`
}

export function publicLicense(license, extras = {}) {
  if (!license) return null
  return {
    id: license.id,
    store_id: license.store_id,
    store_id_int: license.store_id_int,
    plan_id: license.plan_id,
    license_key: license.license_key,
    status: license.status,
    device_id: license.device_id || null,
    starts_at: license.starts_at,
    expires_at: license.expires_at,
    revoked_at: license.revoked_at,
    revoked_reason: license.revoked_reason,
    ...extras,
  }
}

export async function issueLicense(store, plan, startsAt, { transaction }) {
  return StoreLicense.create(
    {
      store_id: store.id,
      store_id_int: store.store_id_int,
      plan_id: plan.id,
      license_key: generateLicenseKey(),
      status: "pending",
      starts_at: startsAt,
      expires_at: addOneMonth(startsAt),
    },
    { transaction }
  )
}

async function refreshExpired(license) {
  if (
    (license.status === "active" || license.status === "pending") &&
    isExpired(license.expires_at)
  ) {
    await license.update({ status: "expired" })
  }
  return license
}

async function loadLicenseByKey(licenseKey) {
  const key = String(licenseKey || "").trim()
  if (!key) throw new AppError("license_key is required", 400)

  const license = await StoreLicense.findOne({
    where: { license_key: key },
    include: [
      { model: Store, attributes: ["id", "name", "slug", "is_active", "pos_enabled", "default_location_id"] },
      { model: Plan, attributes: ["id", "code", "name", "max_devices", "max_locations"] },
      { model: PosDevice, as: "device" },
    ],
  })
  if (!license) throw new NotFoundError("License key is invalid")
  await refreshExpired(license)
  return license
}

function assertStoreUsable(license) {
  if (license.status === "revoked") {
    throw new AppError("License has been revoked", 403)
  }
  if (license.status === "expired") {
    throw new AppError("License has expired", 403)
  }
  if (license.Store && !license.Store.is_active) {
    throw new AppError("Store is suspended", 403)
  }
  if (license.Store && !license.Store.pos_enabled) {
    throw new AppError("POS is disabled for this store", 403)
  }
}

function licenseExtras(license) {
  return {
    store: license.Store
      ? {
          id: license.Store.id,
          name: license.Store.name,
          slug: license.Store.slug,
        }
      : null,
    plan: license.Plan
      ? {
          id: license.Plan.id,
          code: license.Plan.code,
          name: license.Plan.name,
          max_devices: license.Plan.max_devices,
          max_locations: license.Plan.max_locations,
        }
      : null,
    device: license.device || null,
  }
}

export async function inspectLicenseKey(licenseKey) {
  const license = await loadLicenseByKey(licenseKey)
  assertStoreUsable(license)
  return publicLicense(license, licenseExtras(license))
}

export async function validateLicenseKey(licenseKey) {
  const license = await loadLicenseByKey(licenseKey)
  assertStoreUsable(license)
  if (license.status === "pending") {
    throw new AppError("License has not been activated", 403)
  }
  if (license.status !== "active") {
    throw new AppError("License is not active", 403)
  }
  return publicLicense(license, licenseExtras(license))
}

async function assertActivator(storeId, { email, password, pin }) {
  const user = await User.findOne({
    where: { email: email.toLowerCase(), store_id: storeId },
  })
  if (!user || !user.is_active) {
    throw new UnauthorizedError("Invalid email or credentials")
  }
  if (!ACTIVATOR_ROLES.has(user.role)) {
    throw new ForbiddenError("Only store admin or manager can activate a POS device")
  }

  if (password) {
    const ok = await comparePassword(password, user.password)
    if (!ok) throw new UnauthorizedError("Invalid email or credentials")
    return user
  }

  if (!user.pin || user.pin !== pin) {
    throw new UnauthorizedError("Invalid email or credentials")
  }
  return user
}

async function resolveActivateLocation(user, store, locationId) {
  if (locationId) {
    if (user.role === "manager" && locationId !== user.location_id) {
      throw new ForbiddenError("Managers can only activate a device at their location")
    }
    return locationId
  }
  if (user.role === "manager" && user.location_id) return user.location_id
  if (store?.default_location_id) return store.default_location_id
  throw new AppError("location_id is required to register this POS", 400)
}

export async function activateLicenseKey(input, meta = {}) {
  if (!input.device_uid) {
    return inspectLicenseKey(input.license_key)
  }

  const license = await loadLicenseByKey(input.license_key)
  assertStoreUsable(license)
  const user = await assertActivator(license.store_id, input)
  const location_id = await resolveActivateLocation(user, license.Store, input.location_id)

  if (license.status === "active") {
    const bound = license.device || (license.device_id ? await PosDevice.findByPk(license.device_id) : null)
    if (bound && bound.device_uid === input.device_uid) {
      return publicLicense(license, {
        ...licenseExtras(license),
        device: bound,
        activated_by: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          location_id: user.location_id,
        },
      })
    }
    throw new ConflictError("This license key is already activated on another device")
  }

  if (license.status !== "pending") {
    throw new AppError("License cannot be activated", 409)
  }

  const existingUid = await PosDevice.findOne({
    where: { store_id: license.store_id, device_uid: input.device_uid },
  })
  if (existingUid) {
    const other = await StoreLicense.findOne({
      where: { device_id: existingUid.id, status: "active" },
    })
    if (other && other.id !== license.id) {
      throw new ConflictError("This device is already bound to another license")
    }
  }

  const { registerDevice } = await import("../pos/posDevice.service.js")
  const store = await Store.findByPk(license.store_id)
  const device = await registerDevice(
    {
      device_uid: input.device_uid,
      name: input.name,
      location_id,
      platform: input.platform,
      app_version: input.app_version,
    },
    user,
    { store }
  )

  await license.update({
    status: "active",
    device_id: device.id,
  })

  await writeAudit({
    action: "license_activate",
    entity_type: "store_licenses",
    entity_id: license.id,
    store_id: license.store_id,
    store_id_int: license.store_id_int,
    location_id: device.location_id,
    location_id_int: device.location_id_int,
    device_id: device.id,
    user_id: user.id,
    channel: "pos",
    ip_address: meta.ip,
    user_agent: meta.userAgent,
    note: device.device_uid,
  })

  return publicLicense(license, {
    ...licenseExtras(license),
    device,
    activated_by: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      location_id: user.location_id,
    },
  })
}

export async function getCurrentLicense(storeId) {
  const license = await StoreLicense.findOne({
    where: { store_id: storeId },
    order: [["created_at", "DESC"]],
    include: [{ model: PosDevice, as: "device" }],
  })
  if (!license) throw new NotFoundError("License not found")
  await refreshExpired(license)
  return publicLicense(license, { device: license.device || null })
}

export async function listStoreLicenses(storeId) {
  const rows = await StoreLicense.findAll({
    where: { store_id: storeId },
    include: [{ model: PosDevice, as: "device" }, { model: Plan, attributes: ["id", "code", "name"] }],
    order: [["created_at", "DESC"]],
  })
  for (const row of rows) await refreshExpired(row)
  return rows.map((row) => publicLicense(row, { device: row.device || null, plan: row.Plan || null }))
}

export async function getStoreLicense(storeId, id) {
  const license = await StoreLicense.findOne({
    where: { id, store_id: storeId },
    include: [{ model: PosDevice, as: "device" }, { model: Plan, attributes: ["id", "code", "name"] }],
  })
  if (!license) throw new NotFoundError("License not found")
  await refreshExpired(license)
  return publicLicense(license, { device: license.device || null, plan: license.Plan || null })
}

export async function getLicenseByLocation(storeId, locationId, actor) {
  if (actor.role === "manager" && actor.location_id !== locationId) {
    throw new ForbiddenError("Managers can only view their location license")
  }

  const location = await Location.findOne({ where: { id: locationId, store_id: storeId } })
  if (!location) throw new NotFoundError("Location not found")

  const license = await StoreLicense.findOne({
    where: { store_id: storeId },
    include: [
      {
        model: PosDevice,
        as: "device",
        required: true,
        where: { location_id: locationId },
      },
      { model: Plan, attributes: ["id", "code", "name"] },
    ],
    order: [["updated_at", "DESC"]],
  })
  if (!license) throw new NotFoundError("No license is activated at this location")
  await refreshExpired(license)
  return publicLicense(license, { device: license.device || null, plan: license.Plan || null })
}

export async function listAllLicenses() {
  const rows = await StoreLicense.findAll({
    include: [
      { model: Store, attributes: ["id", "name", "slug"] },
      { model: Plan, attributes: ["id", "code", "name"] },
      { model: PosDevice, as: "device" },
    ],
    order: [["created_at", "DESC"]],
  })
  for (const row of rows) await refreshExpired(row)
  return rows.map((row) =>
    publicLicense(row, {
      store: row.Store || null,
      plan: row.Plan || null,
      device: row.device || null,
    })
  )
}

export async function getAdminLicense(id) {
  const license = await StoreLicense.findByPk(id, {
    include: [
      { model: Store, attributes: ["id", "name", "slug"] },
      { model: Plan, attributes: ["id", "code", "name"] },
      { model: PosDevice, as: "device" },
    ],
  })
  if (!license) throw new NotFoundError("License not found")
  await refreshExpired(license)
  return publicLicense(license, {
    store: license.Store || null,
    plan: license.Plan || null,
    device: license.device || null,
  })
}

export async function createLicense(input) {
  const store = await Store.findByPk(input.store_id)
  if (!store) throw new NotFoundError("Store not found")

  const plan = await Plan.findByPk(input.plan_id || store.plan_id)
  if (!plan || !plan.is_active) throw new NotFoundError("Plan not found")

  const liveCount = await StoreLicense.count({
    where: { store_id: store.id, status: ["pending", "active"] },
  })
  await assertPlan(store, "max_devices", { count: liveCount, extra: 1 })

  const license = await issueLicense(store, plan, new Date(), {})
  return publicLicense(license)
}

export async function updateLicense(id, fields) {
  const license = await StoreLicense.findByPk(id)
  if (!license) throw new NotFoundError("License not found")
  if (license.status === "revoked") {
    throw new AppError("Revoked license cannot be updated", 409)
  }
  if (fields.plan_id) {
    const plan = await Plan.findByPk(fields.plan_id)
    if (!plan || !plan.is_active) throw new NotFoundError("Plan not found")
  }
  await license.update(fields)
  await refreshExpired(license)
  return publicLicense(license)
}

export async function revokeLicense(id, reason) {
  const license = await StoreLicense.findByPk(id)
  if (!license) throw new NotFoundError("License not found")
  if (license.status === "revoked") {
    throw new ConflictError("License is already revoked")
  }

  await license.update({
    status: "revoked",
    revoked_at: new Date(),
    revoked_reason: reason || null,
  })
  return publicLicense(license)
}

export async function renewLicense(id) {
  const license = await StoreLicense.findByPk(id)
  if (!license) throw new NotFoundError("License not found")
  if (license.status === "revoked") {
    throw new AppError("Revoked license cannot be renewed", 409)
  }

  const now = new Date()
  const base =
    license.expires_at && new Date(license.expires_at) > now
      ? new Date(license.expires_at)
      : now

  const nextStatus = license.status === "expired" ? "pending" : license.status
  await license.update({
    status: nextStatus,
    expires_at: addOneMonth(base),
    revoked_at: null,
    revoked_reason: null,
  })
  return publicLicense(license)
}
