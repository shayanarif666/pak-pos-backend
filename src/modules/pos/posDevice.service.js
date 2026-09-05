import { PosDevice } from "./posDevice.model.js"
import { Location } from "../locations/location.model.js"
import { Store } from "../stores/store.model.js"
import { validateLicenseKey } from "../stores/license.service.js"
import { getStoreForManager } from "../stores/store.service.js"
import { assertPlan } from "../../shared/utils/plan.util.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

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

export async function registerDevice(input, user, { store: existingStore } = {}) {
  const store = existingStore || (await resolveStoreFromInput(input, user))
  if (user?.role === "manager" && input.location_id !== user.location_id) {
    throw new ForbiddenError("Managers can only register a device at their location")
  }

  const location = await resolveLocation(store.id, input.location_id)
  const existing = await PosDevice.findOne({
    where: { store_id: store.id, device_uid: input.device_uid },
  })

  if (existing) {
    const becomingActive = !existing.is_active
    if (becomingActive) {
      await assertDeviceCap(store, 1)
    }
    await existing.update({
      name: input.name,
      location_id: location.id,
      location_id_int: location.location_id_int,
      platform: input.platform,
      app_version: input.app_version,
      last_seen_at: new Date(),
      is_active: true,
    })
    return existing
  }

  await assertDeviceCap(store, 1)
  return PosDevice.create({
    store_id: store.id,
    store_id_int: store.store_id_int,
    location_id: location.id,
    location_id_int: location.location_id_int,
    device_uid: input.device_uid,
    name: input.name,
    platform: input.platform,
    app_version: input.app_version,
    last_seen_at: new Date(),
    is_active: true,
  })
}

async function assertDeviceCap(store, extra) {
  const active = await PosDevice.count({
    where: { store_id: store.id, is_active: true },
  })
  await assertPlan(store, "max_devices", { count: active, extra })
}

export async function listDevices(actor, query = {}) {
  const where = { store_id: actor.store_id }
  if (actor.role === "manager") where.location_id = actor.location_id
  else if (query.locationId) where.location_id = query.locationId
  return PosDevice.findAll({
    where,
    order: [["created_at", "ASC"]],
  })
}

export async function listAllDevices() {
  return PosDevice.findAll({
    include: [
      { model: Store, attributes: ["id", "name", "slug"] },
      { model: Location, attributes: ["id", "name"] },
    ],
    order: [["created_at", "ASC"]],
  })
}

export async function adminCreateDevice(input) {
  const store = await Store.findByPk(input.store_id)
  if (!store) throw new NotFoundError("Store not found")
  return registerDevice(input, null, { store })
}

export async function heartbeat(actor, id) {
  const where = { id, store_id: actor.store_id }
  if (actor.role === "manager" || actor.role === "cashier") {
    where.location_id = actor.location_id
  }
  const device = await PosDevice.findOne({ where })
  if (!device || !device.is_active) throw new NotFoundError("Device not found")
  await device.update({ last_seen_at: new Date() })
  return device
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
  return device
}
