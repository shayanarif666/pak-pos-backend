import { Op } from "sequelize"
import { Location } from "./location.model.js"
import { sequelize } from "../../db/sequelize.js"
import {
  ensureSequenceAtLeast,
  nextLocationID,
} from "../../shared/utils/counter.util.js"
import { setStoreDefaultLocation } from "../stores/store.service.js"
import { assertPlan } from "../../shared/utils/plan.util.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"

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

export async function listLocations(storeId) {
  return Location.findAll({
    where: { store_id: storeId },
    order: [
      ["location_id_int", "ASC"],
    ],
  })
}

export async function getLocation(storeId, locationId) {
  const location = await Location.findOne({
    where: { id: locationId, store_id: storeId },
  })
  if (!location) throw new NotFoundError("Location not found")
  return location
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

    return location
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

  return sequelize.transaction(async (transaction) => {
    await location.update(fields, { transaction })
    if (fields.is_default === true) {
      await unsetOtherDefaults(storeId, location.id, transaction)
      await setStoreDefaultLocation(storeId, location, { transaction })
      await location.reload({ transaction })
    }
    return location
  })
}
