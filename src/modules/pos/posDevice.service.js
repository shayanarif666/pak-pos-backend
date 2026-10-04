import { Op } from "sequelize"
import { PosDevice } from "./posDevice.model.js"
import { StoreLicense } from "../stores/storeLicense.model.js"
import { Location } from "../locations/location.model.js"
import { Store } from "../stores/store.model.js"
import { readDeviceUuids, validateLicenseKey } from "../stores/license.service.js"
import { getStoreForManager } from "../stores/store.service.js"
import { assertPlan } from "../../shared/utils/plan.util.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

export function publicDevice(row) {
  if (!row) return null
  const json = row.toJSON ? row.toJSON() : row
  const { store_id_int, location_id_int, Store, Location, ...rest } = json
  return {
    ...rest,
    store_number: store_id_int,
    location_number: location_id_int,
    store_name: Store?.name || json.store_name || null,
    store_slug: Store?.slug || json.store_slug || null,
    location_name: Location?.name || json.location_name || null,
  }
}

const STAFF_ROLES = new Set(["store_admin", "manager", "cashier"])

async function resolveLocation(storeId, locationId) {
  const location = await Location.findOne({
    where: { id: locationId, store_id: storeId, is_active: true },
  })
  if (!location) throw new NotFoundError("Location not found")
  return location
}

async function resolveStoreFromInput(input, user) {
  if (user && STAFF_ROLES.has(user.role) && user.store_id) {
    const store = await getStoreForManager(user.store_id)
    return store
  }
  if (!input.license_key) {
    throw new AppError("license_key is required to register a device", 400)
  }
  const license = await validateLicenseKey(input.license_key)
  const store = await Store.findByPk(license.store_id)
  if (!store) throw new NotFoundError("Store not found")
  return store
}

/**
 * withoutLocation: used by license activation (POST /licenses/validate). A new till is saved with
 * no location, and an existing till keeps the location it has; only PATCH /pos-devices/:id
 * (store admin) sets or changes it.
 */
export async function registerDevice(
  input,
  user,
  { store: existingStore, withoutLocation = false } = {}
) {
  const store = existingStore || (await resolveStoreFromInput(input, user))
  let location = null
  if (!withoutLocation) {
    const locationId = input.location_id || user?.location_id
    if (!locationId) throw new AppError("location_id is required", 400)
    if (user?.role === "manager" && locationId !== user.location_id) {
      throw new ForbiddenError("Managers can only register a device at their location")
    }
    location = await resolveLocation(store.id, locationId)
  }

  const existing = await PosDevice.findOne({
    where: { store_id: store.id, device_uid: input.device_uid },
  })

  if (existing) {
    if (user?.role === "manager" && existing.location_id !== user.location_id) {
      throw new ForbiddenError("Managers cannot re-register a device from another location")
    }
    const becomingActive = !existing.is_active
    if (becomingActive) {
      await assertDeviceCap(store, 1)
    }
    await existing.update({
      name: input.name,
      ...(location ? { location_id: location.id, location_id_int: location.location_id_int } : {}),
      platform: input.platform,
      app_version: input.app_version,
      last_seen_at: new Date(),
      is_active: true,
    })
    return publicDevice(existing)
  }

  await assertDeviceCap(store, 1)
  return publicDevice(
    await PosDevice.create({
      store_id: store.id,
      store_id_int: store.store_id_int,
      location_id: location?.id || null,
      location_id_int: location?.location_id_int ?? null,
      device_uid: input.device_uid,
      name: input.name,
      platform: input.platform,
      app_version: input.app_version,
      last_seen_at: new Date(),
      is_active: true,
    })
  )
}

async function assertDeviceCap(store, extra) {
  const active = await PosDevice.count({
    where: { store_id: store.id, is_active: true },
  })
  await assertPlan(store, "max_devices", { count: active, extra })
}

export async function listDevices(actor, query = {}) {
  const where = { store_id: actor.store_id }
  if (actor.role === "manager") {
    where.location_id = actor.location_id
  } else if (query.locationId || query.location_id) {
    where.location_id = query.locationId || query.location_id
  }
  const rows = await PosDevice.findAll({
    where,
    order: [["created_at", "ASC"]],
  })
  return rows.map(publicDevice)
}

export async function listAllDevices(query = {}) {
  const where = {}
  if (query.store_id) where.store_id = query.store_id
  if (query.location_id || query.locationId) {
    where.location_id = query.location_id || query.locationId
  }
  if (query.is_active !== undefined && query.is_active !== "") {
    where.is_active = String(query.is_active) === "true" || query.is_active === true
  }
  const rows = await PosDevice.findAll({
    where,
    include: [
      { model: Store, attributes: ["id", "name", "slug"] },
      { model: Location, attributes: ["id", "name"] },
    ],
    order: [["created_at", "DESC"]],
  })
  return rows.map(publicDevice)
}

export async function adminCreateDevice(input) {
  const store = await Store.findByPk(input.store_id)
  if (!store) throw new NotFoundError("Store not found")
  return registerDevice(input, null, { store })
}

export async function heartbeat(actor, id) {
  const where = { id, store_id: actor.store_id }
  if (actor.role === "manager" || actor.role === "cashier") {
    // A till not yet assigned to a branch can still report in.
    where.location_id = { [Op.or]: [actor.location_id, null] }
  }
  const device = await PosDevice.findOne({ where })
  if (!device || !device.is_active) throw new NotFoundError("Device not found")
  await device.update({ last_seen_at: new Date() })
  return publicDevice(device)
}

export async function patchDevice(actor, id, fields) {
  const device = await PosDevice.findOne({
    where: { id, store_id: actor.store_id },
  })
  if (!device) throw new NotFoundError("Device not found")

  const patch = { ...fields }
  if (fields.location_id) {
    const location = await resolveLocation(actor.store_id, fields.location_id)
    patch.location_id = location.id
    patch.location_id_int = location.location_id_int
  }
  if (fields.is_active === true && !device.is_active) {
    const store = await getStoreForManager(actor.store_id)
    await assertDeviceCap(store, 1)
  }
  await device.update(patch)
  if (patch.location_id) await syncLicenseDeviceLocation(device)
  return publicDevice(device)
}

// License device lists keep a copy of each till's location (used by GET /licenses/location/:id).
async function syncLicenseDeviceLocation(device) {
  const licenses = await StoreLicense.findAll({ where: { store_id: device.store_id } })
  for (const license of licenses) {
    const entries = readDeviceUuids(license)
    if (!entries.some((entry) => entry?.device_uid === device.device_uid)) continue
    await license.update({
      device_uuids: entries.map((entry) =>
        entry?.device_uid === device.device_uid ? { ...entry, location_id: device.location_id } : entry
      ),
    })
  }
}
