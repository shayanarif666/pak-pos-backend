import { Op, UniqueConstraintError } from "sequelize"
import { Location } from "./location.model.js"
import { User } from "../auth/user.model.js"
import { sequelize } from "../../db/sequelize.js"
import {
  ensureSequenceAtLeast,
  nextLocationID,
} from "../../shared/utils/counter.util.js"
import { setStoreDefaultLocation } from "../stores/store.service.js"
import { assertPlan } from "../../shared/utils/plan.util.js"
import { hashPassword } from "../../shared/utils/hash.util.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"

function publicManager(user) {
  if (!user) return null
  const json = user.toJSON ? user.toJSON() : user
  return {
    id: json.id,
    name: json.name,
    email: json.email,
    phone: json.phone || null,
    pin: json.pin || null,
    is_active: json.is_active !== false,
  }
}

export function publicLocation(location, extras = {}) {
  if (!location) return null
  const json = location.toJSON ? location.toJSON() : location
  const manager =
    extras.manager !== undefined
      ? extras.manager
      : publicManager(json.manager || json.User || null)
  return {
    id: json.id,
    store_id: json.store_id,
    store_number: json.store_id_int,
    location_number: json.location_id_int,
    name: json.name,
    address_line: json.address_line,
    city: json.city,
    country: json.country,
    postal_code: json.postal_code,
    phone: json.phone,
    is_default: json.is_default,
    is_active: json.is_active,
    manager,
    created_at: json.created_at,
    updated_at: json.updated_at,
  }
}

export async function createMainCounter(store, fields, { transaction }) {
  const location = await Location.create(
    {
      store_id: store.id,
      store_id_int: store.store_id_int,
      location_id_int: 1,
      name: fields.name,
      address_line: store.address,
      city: "N/A",
      phone: fields.phone,
      is_default: true,
      is_active: true,
    },
    { transaction }
  )
  await ensureSequenceAtLeast(`location:${store.id}`, 1, transaction)
  return location
}

async function unsetOtherDefaults(storeId, keepId, transaction) {
  await Location.update(
    { is_default: false },
    {
      where: { store_id: storeId, id: { [Op.ne]: keepId } },
      transaction,
    }
  )
}

async function assertManagerCredentialsFree(
  storeId,
  email,
  pin,
  transaction,
  exceptUserId = null
) {
  if (email) {
    const where = { store_id: storeId, email }
    if (exceptUserId) where.id = { [Op.ne]: exceptUserId }
    const emailTaken = await User.findOne({ where, transaction })
    if (emailTaken) throw new ConflictError("Manager email already registered in this store")
  }

  if (pin) {
    const where = { store_id: storeId, pin }
    if (exceptUserId) where.id = { [Op.ne]: exceptUserId }
    const pinTaken = await User.findOne({ where, transaction })
    if (pinTaken) throw new ConflictError("Manager PIN is already used in this store")
  }
}

async function createLocationManager(store, location, manager, transaction) {
  if (!manager) throw new AppError("manager is required", 400)
  await assertManagerCredentialsFree(store.id, manager.email, manager.pin, transaction)

  try {
    return await User.create(
      {
        store_id: store.id,
        store_id_int: store.store_id_int,
        location_id: location.id,
        location_id_int: location.location_id_int,
        name: manager.name,
        email: manager.email,
        password: await hashPassword(manager.password),
        pin: manager.pin,
        phone: manager.phone,
        role: "manager",
        is_verified: true,
        is_active: true,
      },
      { transaction }
    )
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      const fields = err.errors?.map((e) => e.path) || []
      if (fields.includes("pin")) {
        throw new ConflictError("Manager PIN is already used in this store")
      }
      throw new ConflictError("Manager email already registered in this store")
    }
    throw err
  }
}

async function resolveManagersForLocations(storeId, locations) {
  if (!locations.length) {
    return () => null
  }

  const rows = await User.findAll({
    where: {
      store_id: storeId,
      role: "manager",
    },
    order: [
      ["is_active", "DESC"],
      ["created_at", "ASC"],
    ],
  })

  const byLocationId = new Map()
  const byLocationInt = new Map()
  for (const user of rows) {
    if (user.location_id != null) {
      const key = String(user.location_id).toLowerCase()
      if (!byLocationId.has(key)) byLocationId.set(key, user)
    }
    if (user.location_id_int != null && user.location_id_int !== "") {
      const key = Number(user.location_id_int)
      if (!Number.isNaN(key) && !byLocationInt.has(key)) {
        byLocationInt.set(key, user)
      }
    }
  }

  return (location) => {
    const idKey = String(location.id).toLowerCase()
    if (byLocationId.has(idKey)) return byLocationId.get(idKey)
    const intKey = Number(location.location_id_int)
    if (!Number.isNaN(intKey) && byLocationInt.has(intKey)) {
      return byLocationInt.get(intKey)
    }
    return null
  }
}

export async function listLocations(storeId) {
  const rows = await Location.findAll({
    where: { store_id: storeId },
    order: [["location_id_int", "ASC"]],
    include: [
      {
        model: User,
        as: "users",
        required: false,
        where: { role: "manager" },
        attributes: ["id", "name", "email", "phone", "pin", "is_active", "location_id", "location_id_int", "created_at"],
      },
    ],
  })
  const findManager = await resolveManagersForLocations(storeId, rows)
  return rows.map((row) => {
    const included =
      Array.isArray(row.users) && row.users.length
        ? [...row.users].sort((a, b) => Number(b.is_active) - Number(a.is_active))[0]
        : null
    return publicLocation(row, {
      manager: publicManager(included || findManager(row)),
    })
  })
}

export async function getLocation(storeId, locationId) {
  const location = await Location.findOne({
    where: { id: locationId, store_id: storeId },
  })
  if (!location) throw new NotFoundError("Location not found")
  return location
}

export async function getPublicLocation(storeId, locationId) {
  const location = await getLocation(storeId, locationId)
  const findManager = await resolveManagersForLocations(storeId, [location])
  return publicLocation(location, {
    manager: publicManager(findManager(location)),
  })
}

export async function resolveLocation(locationId) {
  if (!locationId) throw new AppError("locationId is required", 400)
  const location = await Location.findByPk(locationId)
  if (!location) throw new NotFoundError("Location not found")
  return {
    location_id: location.id,
    location_id_int: location.location_id_int,
    store_id: location.store_id,
    store_id_int: location.store_id_int,
  }
}

export async function createLocation(store, fields) {
  return sequelize.transaction(async (transaction) => {
    const count = await Location.count({
      where: { store_id: store.id },
      transaction,
    })
    await assertPlan(store, "max_locations", { count })

    let location_id_int = await nextLocationID(store.id, transaction)
    while (
      await Location.findOne({
        where: { store_id: store.id, location_id_int },
        transaction,
      })
    ) {
      location_id_int = await nextLocationID(store.id, transaction)
    }

    const location = await Location.create(
      {
        store_id: store.id,
        store_id_int: store.store_id_int,
        location_id_int,
        name: fields.name,
        address_line: fields.address_line,
        city: fields.city,
        postal_code: fields.postal_code,
        phone: fields.phone,
        is_active: fields.is_active,
        is_default: fields.is_default,
      },
      { transaction }
    )

    if (location.is_default) {
      await unsetOtherDefaults(store.id, location.id, transaction)
      await setStoreDefaultLocation(store.id, location, { transaction })
    }

    const manager = await createLocationManager(
      store,
      location,
      fields.manager,
      transaction
    )

    return publicLocation(location, {
      manager: {
        ...publicManager(manager),
        password: fields.manager.password,
      },
    })
  })
}

export async function updateLocation(storeId, locationId, fields, actor) {
  const location = await Location.findOne({
    where: { id: locationId, store_id: storeId },
  })
  if (!location) throw new NotFoundError("Location not found")
  if (actor?.role === "manager" && location.id !== actor.location_id) {
    throw new ForbiddenError("Managers can only edit their location")
  }

  const { manager: managerFields, ...locationFields } = fields

  if (managerFields && actor?.role !== "store_admin") {
    throw new ForbiddenError("Only the store admin can edit location managers")
  }

  return sequelize.transaction(async (transaction) => {
    if (Object.keys(locationFields).length) {
      await location.update(locationFields, { transaction })
    }
    if (locationFields.is_default === true) {
      await unsetOtherDefaults(storeId, location.id, transaction)
      await setStoreDefaultLocation(storeId, location, { transaction })
      await location.reload({ transaction })
    }

    const findManager = await resolveManagersForLocations(storeId, [location])
    let managerUser = findManager(location)

    if (managerFields) {
      if (managerUser) {
        const patch = {}
        if (managerFields.name !== undefined) patch.name = managerFields.name
        if (managerFields.email !== undefined) {
          await assertManagerCredentialsFree(
            storeId,
            managerFields.email,
            null,
            transaction,
            managerUser.id
          )
          patch.email = managerFields.email
        }
        if (managerFields.phone !== undefined) patch.phone = managerFields.phone
        if (managerFields.is_active !== undefined) patch.is_active = managerFields.is_active
        if (managerFields.password) {
          patch.password = await hashPassword(managerFields.password)
        }
        if (managerFields.pin) {
          await assertManagerCredentialsFree(
            storeId,
            null,
            managerFields.pin,
            transaction,
            managerUser.id
          )
          patch.pin = managerFields.pin
        }
        if (Object.keys(patch).length) {
          await managerUser.update(patch, { transaction })
          await managerUser.reload({ transaction })
        }
      } else {
        if (
          !managerFields.name ||
          !managerFields.email ||
          !managerFields.password ||
          !managerFields.pin
        ) {
          throw new AppError(
            "manager_name, manager_email, manager_password, and manager_pin are required to add a manager",
            400
          )
        }
        managerUser = await createLocationManager(
          { id: storeId, store_id_int: location.store_id_int },
          location,
          managerFields,
          transaction
        )
      }
    }

    return publicLocation(location, {
      manager: publicManager(managerUser),
    })
  })
}
