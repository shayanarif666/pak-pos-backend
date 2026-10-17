import { Op } from "sequelize"
import { User } from "./user.model.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"

export const PIN_TAKEN_MESSAGE =
  "PIN is already used by someone at this location. Choose a different PIN"

/**
 * A PIN must be unique among the staff of one location. The same PIN may be reused at another
 * location or in another store — POS PIN sign-in tells them apart by the till (device) it comes
 * from. The store admin can sign in at every location of the store, so their PIN must differ
 * from everyone's in that store, and nobody in the store may take the admin's PIN.
 */
export async function assertPinAvailable(
  pin,
  { storeId, locationId = null, role = null, exceptUserId, transaction } = {}
) {
  if (!pin || !storeId) return
  const where = { store_id: storeId, pin }
  if (exceptUserId) where.id = { [Op.ne]: exceptUserId }
  const rows = await User.findAll({
    where,
    attributes: ["id", "role", "location_id"],
    transaction,
  })
  const clash = rows.some(
    (row) =>
      role === "store_admin" ||
      row.role === "store_admin" ||
      (row.location_id || null) === (locationId || null)
  )
  if (clash) throw new ConflictError(PIN_TAKEN_MESSAGE)
}

/** Same PIN rule, for a user row that already exists (its own store/location/role). */
export function assertUserPinAvailable(user, pin, { locationId, transaction } = {}) {
  return assertPinAvailable(pin, {
    storeId: user.store_id,
    locationId: locationId !== undefined ? locationId : user.location_id,
    role: user.role,
    exceptUserId: user.id,
    transaction,
  })
}
