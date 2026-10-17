import { Op } from "sequelize"
import { User } from "./user.model.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"

export const PIN_TAKEN_MESSAGE =
  "PIN is already used by someone at this location. Choose a different PIN"

/**
 * A PIN must be unique among the users of one location (the store admin counts as a user of
 * their own location). The same PIN may be reused at another location or in another store —
 * POS PIN sign-in tells them apart by the till (device) it comes from.
 */
export async function assertPinAvailable(
  pin,
  { storeId, locationId = null, exceptUserId, transaction } = {}
) {
  if (!pin || !storeId) return
  const where = { store_id: storeId, location_id: locationId || null, pin }
  if (exceptUserId) where.id = { [Op.ne]: exceptUserId }
  const taken = await User.findOne({ where, attributes: ["id"], transaction })
  if (taken) throw new ConflictError(PIN_TAKEN_MESSAGE)
}

/** Same PIN rule, for a user row that already exists (its own store/location). */
export function assertUserPinAvailable(user, pin, { locationId, transaction } = {}) {
  return assertPinAvailable(pin, {
    storeId: user.store_id,
    locationId: locationId !== undefined ? locationId : user.location_id,
    exceptUserId: user.id,
    transaction,
  })
}
