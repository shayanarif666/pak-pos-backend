import crypto from "crypto"
import { Op } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { StoreLicense } from "./storeLicense.model.js"
import { Store } from "./store.model.js"
import { Plan } from "../plans/plan.model.js"
import { PosDevice } from "../pos/posDevice.model.js"
import { Location } from "../locations/location.model.js"
import { addOneMonth, isExpired } from "../../shared/utils/date.util.js"
import { writeAudit } from "../../shared/utils/audit.util.js"
import { assertPlan } from "../../shared/utils/plan.util.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import { createBilling } from "../billings/billing.service.js"

/** Days the Super Admin can give an expired store before payment ("extend" button). */
export const LICENSE_GRACE_DAYS = 2
const DAY_MS = 24 * 60 * 60 * 1000

export function generateLicenseKey() {
  const raw = crypto.randomBytes(8).toString("hex").toUpperCase()
  return `LIC-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`
}

export function readDeviceUuids(license) {
  if (!license) return []
  const value = license.device_uuids
  if (Array.isArray(value)) return value
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function findDeviceEntry(devices, deviceUid) {
  return devices.find((row) => row && row.device_uid === deviceUid) || null
}

function buildDeviceEntry(device) {
  return {
    device_uid: device.device_uid,
    device_id: device.id,
    name: device.name || null,
    location_id: device.location_id || null,
    activated_at: new Date().toISOString(),
  }
}

export function publicLicense(license, extras = {}) {
  if (!license) return null
  const device_uuids = readDeviceUuids(license)
  return {
    id: license.id,
    store_id: license.store_id,
    store_number: license.store_id_int,
    plan_id: license.plan_id,
    license_key: license.license_key,
    status: license.status,
    device_id: license.device_id || device_uuids[0]?.device_id || null,
    device_uuids,
    device_count: device_uuids.length,
    starts_at: license.starts_at,
    expires_at: license.expires_at,
    revoked_at: license.revoked_at,
    revoked_reason: license.revoked_reason,
    grace_days: license.grace_days ?? 0,
    suspended_at: license.suspended_at ?? null,
    suspended_reason: license.suspended_reason ?? null,
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
      device_uuids: [],
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
      { model: Plan, attributes: ["id", "code", "name", "max_devices", "max_locations", "features"] },
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
  if (license.status === "suspended") {
    throw new AppError("License has been suspended", 403)
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
          features: Array.isArray(license.Plan.features) ? license.Plan.features : [],
        }
      : null,
    device: license.device || null,
    devices: readDeviceUuids(license),
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

async function findOtherLicenseWithDeviceUid(storeId, deviceUid, excludeLicenseId) {
  const rows = await StoreLicense.findAll({
    where: {
      store_id: storeId,
      status: { [Op.in]: ["pending", "active"] },
      id: { [Op.ne]: excludeLicenseId },
    },
  })
  return rows.find((row) => findDeviceEntry(readDeviceUuids(row), deviceUid)) || null
}

/**
 * POS activation rules:
 * - Key invalid / expired / revoked            -> error, data.valid = false
 * - Device already registered on this key      -> valid = true (pending key becomes active,
 *                                                  e.g. after a renewal)
 * - New device                                 -> registered only if the store's plan still has
 *                                                  a free device slot (active devices, store-wide)
 * - Device deactivated by the store            -> rejected; the store must re-enable it
 */
export async function activateLicenseKey(input, meta = {}) {
  if (!input.device_uid) {
    return { ...(await inspectLicenseKey(input.license_key)), valid: true }
  }

  const license = await loadLicenseByKey(input.license_key)
  assertStoreUsable(license)

  return sequelize.transaction(async (transaction) => {
    // Serialize activations of one key so two PCs cannot both take the last slot.
    await StoreLicense.findByPk(license.id, { transaction, lock: transaction.LOCK.UPDATE })

    const devices = readDeviceUuids(license)
    const existing = await PosDevice.findOne({
      where: { store_id: license.store_id, device_uid: input.device_uid },
      transaction,
    })
    const alreadyBound = findDeviceEntry(devices, input.device_uid)

    if (existing && !existing.is_active) {
      throw new ForbiddenError(
        "This device has been deactivated by the store. Ask the store admin to re-enable it."
      )
    }

    if (alreadyBound && existing) {
      if (license.status === "pending") {
        await license.update({ status: "active" }, { transaction })
      }
      await existing.update({ last_seen_at: new Date() }, { transaction })
      return publicLicense(license, {
        ...licenseExtras(license),
        device: existing,
        devices,
        already_registered: true,
        valid: true,
      })
    }

    const otherLicense = await findOtherLicenseWithDeviceUid(
      license.store_id,
      input.device_uid,
      license.id
    )
    if (otherLicense) {
      throw new ConflictError("This device is already bound to another license")
    }

    // registerDevice() enforces plans.max_devices across all active devices of the store.
    // The till is registered without a location; the store admin assigns it later with
    // PATCH /pos-devices/:id (an already known till keeps its location).
    const { registerDevice } = await import("../pos/posDevice.service.js")
    const store = await Store.findByPk(license.store_id, { transaction })
    const device = await registerDevice(
      {
        device_uid: input.device_uid,
        name: input.name || `POS ${input.device_uid}`,
        platform: input.platform,
        app_version: input.app_version,
      },
      null,
      { store, withoutLocation: true }
    )

    const nextDevices = [
      ...devices.filter((row) => row?.device_uid !== input.device_uid),
      buildDeviceEntry(device),
    ]
    await license.update(
      {
        status: "active",
        device_id: license.device_id || device.id,
        device_uuids: nextDevices,
      },
      { transaction }
    )

    await writeAudit({
      action: "license_activate",
      entity_type: "store_licenses",
      entity_id: license.id,
      store_id: license.store_id,
      store_id_int: license.store_id_int,
      location_id: device.location_id,
      location_id_int: device.location_id_int,
      device_id: device.id,
      user_id: null,
      channel: "pos",
      ip_address: meta.ip,
      user_agent: meta.userAgent,
      note: device.device_uid,
    })

    return publicLicense(license, {
      ...licenseExtras(license),
      device,
      devices: nextDevices,
      already_registered: false,
      valid: true,
    })
  })
}

const LICENSE_STATUS_RANK = { active: 0, pending: 1, suspended: 2, expired: 3, revoked: 4 }

/** The license the store is actually running on: active first, then pending, newest expiry. */
export async function getCurrentLicense(storeId) {
  const rows = await StoreLicense.findAll({
    where: { store_id: storeId },
    include: [
      { model: PosDevice, as: "device" },
      { model: Plan, attributes: ["id", "code", "name", "max_devices"] },
    ],
  })
  if (!rows.length) throw new NotFoundError("License not found")
  for (const row of rows) await refreshExpired(row)
  const license = rows.sort(
    (a, b) =>
      (LICENSE_STATUS_RANK[a.status] ?? 9) - (LICENSE_STATUS_RANK[b.status] ?? 9) ||
      new Date(b.expires_at) - new Date(a.expires_at)
  )[0]
  return publicLicense(license, {
    device: license.device || null,
    plan: license.Plan || null,
    devices: readDeviceUuids(license),
  })
}

export async function listStoreLicenses(storeId) {
  const rows = await StoreLicense.findAll({
    where: { store_id: storeId },
    include: [
      { model: PosDevice, as: "device" },
      { model: Plan, attributes: ["id", "code", "name", "max_devices"] },
    ],
    order: [["created_at", "DESC"]],
  })
  for (const row of rows) await refreshExpired(row)
  return rows.map((row) =>
    publicLicense(row, {
      device: row.device || null,
      plan: row.Plan || null,
      devices: readDeviceUuids(row),
    })
  )
}

export async function getStoreLicense(storeId, id) {
  const license = await StoreLicense.findOne({
    where: { id, store_id: storeId },
    include: [
      { model: PosDevice, as: "device" },
      { model: Plan, attributes: ["id", "code", "name", "max_devices"] },
    ],
  })
  if (!license) throw new NotFoundError("License not found")
  await refreshExpired(license)
  return publicLicense(license, {
    device: license.device || null,
    plan: license.Plan || null,
    devices: readDeviceUuids(license),
  })
}

export async function getLicenseByLocation(storeId, locationId, actor) {
  if (actor.role === "manager" && actor.location_id !== locationId) {
    throw new ForbiddenError("Managers can only view their location license")
  }

  const location = await Location.findOne({ where: { id: locationId, store_id: storeId } })
  if (!location) throw new NotFoundError("Location not found")

  const locationDevices = await PosDevice.findAll({
    where: { store_id: storeId, location_id: locationId },
  })
  const locationUids = new Set(locationDevices.map((row) => row.device_uid))

  const rows = await StoreLicense.findAll({
    where: { store_id: storeId },
    include: [
      { model: PosDevice, as: "device" },
      { model: Plan, attributes: ["id", "code", "name", "max_devices"] },
    ],
    order: [["updated_at", "DESC"]],
  })

  const license = rows.find((row) => {
    const entries = readDeviceUuids(row)
    return entries.some(
      (entry) =>
        (entry.location_id && entry.location_id === locationId) ||
        (entry.device_uid && locationUids.has(entry.device_uid))
    )
  })

  if (!license) throw new NotFoundError("No license is activated at this location")
  await refreshExpired(license)
  return publicLicense(license, {
    device: license.device || null,
    plan: license.Plan || null,
    devices: readDeviceUuids(license),
  })
}

export async function listAllLicenses() {
  const rows = await StoreLicense.findAll({
    include: [
      { model: Store, attributes: ["id", "name", "slug"] },
      { model: Plan, attributes: ["id", "code", "name", "max_devices"] },
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
      devices: readDeviceUuids(row),
    })
  )
}

export async function getAdminLicense(id) {
  const license = await StoreLicense.findByPk(id, {
    include: [
      { model: Store, attributes: ["id", "name", "slug"] },
      { model: Plan, attributes: ["id", "code", "name", "max_devices"] },
      { model: PosDevice, as: "device" },
    ],
  })
  if (!license) throw new NotFoundError("License not found")
  await refreshExpired(license)
  return publicLicense(license, {
    store: license.Store || null,
    plan: license.Plan || null,
    device: license.device || null,
    devices: readDeviceUuids(license),
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

// Status a license returns to once it is no longer suspended / expired: tills that are already
// registered can keep working (active); a key with no till yet waits for activation (pending).
function liveStatus(license) {
  return readDeviceUuids(license).length > 0 ? "active" : "pending"
}

async function loadAdminLicense(id, transaction) {
  const license = await StoreLicense.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE })
  if (!license) throw new NotFoundError("License not found")
  return license
}

async function adminLicenseView(license, transaction) {
  const [store, plan] = await Promise.all([
    Store.findByPk(license.store_id, { attributes: ["id", "name", "slug"], transaction }),
    Plan.findByPk(license.plan_id, {
      attributes: ["id", "code", "name", "max_devices", "max_locations", "price_pkr"],
      transaction,
    }),
  ])
  return publicLicense(license, { store, plan, devices: readDeviceUuids(license) })
}

// Audit actions are a fixed enum, so the license action (extend / renew / suspend / activate)
// is recorded as an "update" with the action name at the start of the note.
async function auditLicense(license, action, actor, detail) {
  const note = detail ? `${action}: ${detail}` : action
  await writeAudit({
    action: "update",
    entity_type: "store_licenses",
    entity_id: license.id,
    store_id: license.store_id,
    store_id_int: license.store_id_int,
    user_id: actor?.id || null,
    channel: "web",
    note,
  })
}

/**
 * Extend: the store promised to pay in a couple of days. Adds LICENSE_GRACE_DAYS from the later
 * of today and the expiry date, and records them so the next renewal takes them back.
 * Allowed once per billing period.
 */
export async function extendLicense(id, actor) {
  const license = await sequelize.transaction(async (transaction) => {
    const row = await loadAdminLicense(id, transaction)
    await refreshExpired(row)
    if (["revoked", "suspended"].includes(row.status)) {
      throw new ConflictError(`A ${row.status} license cannot be extended`)
    }
    if ((row.grace_days || 0) > 0) {
      throw new ConflictError("This license was already extended. Renew it to extend again")
    }

    const now = new Date()
    const base = new Date(row.expires_at) > now ? new Date(row.expires_at) : now
    await row.update(
      {
        expires_at: new Date(base.getTime() + LICENSE_GRACE_DAYS * DAY_MS),
        grace_days: LICENSE_GRACE_DAYS,
        status: row.status === "expired" ? liveStatus(row) : row.status,
      },
      { transaction }
    )
    return row
  })
  await auditLicense(license, "extend", actor, `+${LICENSE_GRACE_DAYS} days`)
  return adminLicenseView(license)
}

/**
 * Renew +1 month for the plan the store bought. Grace days from an earlier extension are taken
 * back, the store moves to that plan, and the billing transaction is recorded.
 */
export async function renewLicense(id, input = {}, actor = null) {
  const { license, billing, plan } = await sequelize.transaction(async (transaction) => {
    const row = await loadAdminLicense(id, transaction)
    if (row.status === "revoked") {
      throw new AppError("Revoked license cannot be renewed", 409)
    }
    await refreshExpired(row)

    const nextPlan = await Plan.findByPk(input.plan_id || row.plan_id, { transaction })
    if (!nextPlan || !nextPlan.is_active) throw new NotFoundError("Plan not found")
    const store = await Store.findByPk(row.store_id, { transaction })
    if (!store) throw new NotFoundError("Store not found")

    // A smaller plan must still fit what the store already uses.
    const [devices, locations] = await Promise.all([
      PosDevice.count({ where: { store_id: store.id, is_active: true }, transaction }),
      Location.count({ where: { store_id: store.id, is_active: true }, transaction }),
    ])
    if (devices > nextPlan.max_devices) {
      throw new ConflictError(
        `${nextPlan.name} allows ${nextPlan.max_devices} device(s) but the store has ${devices} active. Deactivate devices first`
      )
    }
    if (locations > nextPlan.max_locations) {
      throw new ConflictError(
        `${nextPlan.name} allows ${nextPlan.max_locations} location(s) but the store has ${locations} active. Deactivate locations first`
      )
    }

    const now = new Date()
    const periodStart =
      row.expires_at && new Date(row.expires_at) > now ? new Date(row.expires_at) : now
    const graceDays = row.grace_days || 0
    const expiresAt = new Date(addOneMonth(periodStart).getTime() - graceDays * DAY_MS)

    const status = ["expired", "pending"].includes(row.status)
      ? liveStatus(row)
      : row.status // active stays active, suspended stays suspended
    await row.update(
      { plan_id: nextPlan.id, status, expires_at: expiresAt, grace_days: 0 },
      { transaction }
    )
    if (store.plan_id !== nextPlan.id) await store.update({ plan_id: nextPlan.id }, { transaction })

    const billingRow = await createBilling(
      {
        store_id: store.id,
        plan_id: nextPlan.id,
        amount: input.amount ?? nextPlan.price_pkr,
        status: input.billing_status || "paid",
        period_start: periodStart,
        period_end: expiresAt,
        method_note: input.method_note || "manual",
        note: [
          `License ${row.license_key} renewed for 1 month`,
          graceDays ? `${graceDays} grace day(s) deducted` : null,
          input.note || null,
        ]
          .filter(Boolean)
          .join(". "),
      },
      { transaction, createdBy: actor?.id }
    )
    return { license: row, billing: billingRow, plan: nextPlan }
  })

  await auditLicense(license, "renew", actor, `${plan.code}, billing ${billing.id}`)
  return { ...(await adminLicenseView(license)), billing }
}

/** Suspend: the Super Admin blocks the store. Dashboard and POS stop working for its staff. */
export async function suspendLicense(id, reason, actor) {
  const license = await sequelize.transaction(async (transaction) => {
    const row = await loadAdminLicense(id, transaction)
    if (row.status === "revoked") throw new ConflictError("Revoked license cannot be suspended")
    if (row.status === "suspended") throw new ConflictError("License is already suspended")
    await row.update(
      { status: "suspended", suspended_at: new Date(), suspended_reason: reason || null },
      { transaction }
    )
    return row
  })
  await auditLicense(license, "suspend", actor, reason || null)
  return adminLicenseView(license)
}

/** Activate: lift a suspension. If the paid period ran out meanwhile, the license is expired. */
export async function reactivateLicense(id, actor) {
  const license = await sequelize.transaction(async (transaction) => {
    const row = await loadAdminLicense(id, transaction)
    if (row.status !== "suspended") {
      throw new ConflictError("Only a suspended license can be activated")
    }
    await row.update(
      {
        status: isExpired(row.expires_at) ? "expired" : liveStatus(row),
        suspended_at: null,
        suspended_reason: null,
      },
      { transaction }
    )
    return row
  })
  await auditLicense(license, "activate", actor, null)
  return adminLicenseView(license)
}

/** Marks every license whose paid period has ended as expired (runs on a timer). */
export async function expireOverdueLicenses() {
  const [result] = await sequelize.query(
    `UPDATE store_licenses SET status = 'expired', updated_at = NOW()
     WHERE status IN ('active', 'pending') AND expires_at < NOW()`
  )
  return result?.affectedRows ?? 0
}

function accessError(message, code) {
  const err = new AppError(message, 403)
  err.data = { code }
  return err
}

/**
 * Store staff (dashboard and POS) may work only while the store holds a usable license:
 * active or pending, inside its paid period. Otherwise 403 with data.code LICENSE_SUSPENDED or
 * LICENSE_EXPIRED, which the dashboard shows as a blocking alert before signing out.
 */
export async function assertStoreLicenseUsable(storeId) {
  if (!storeId) return
  const licenses = await StoreLicense.findAll({
    where: { store_id: storeId },
    attributes: ["id", "status", "expires_at"],
  })
  const now = new Date()
  const usable = licenses.some(
    (row) => ["active", "pending"].includes(row.status) && new Date(row.expires_at) > now
  )
  if (usable) return
  if (licenses.some((row) => row.status === "suspended")) {
    throw accessError(
      "Your store license has been suspended. Contact Bazar360 support.",
      "LICENSE_SUSPENDED"
    )
  }
  throw accessError(
    "Your store license has expired. Renew your subscription to continue.",
    "LICENSE_EXPIRED"
  )
}
