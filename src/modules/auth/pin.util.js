import { Op } from "sequelize"
import { User } from "./user.model.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"

export const PIN_TAKEN_MESSAGE = "PIN is already in use. Choose a different PIN"

/**
 * POS sign-in sends only the PIN, so a PIN must identify exactly one user across the whole
 * platform, not just inside one store.
 */
export async function assertPinAvailable(pin, { exceptUserId, transaction } = {}) {
  if (!pin) return
  const where = { pin }
  if (exceptUserId) where.id = { [Op.ne]: exceptUserId }
  const taken = await User.findOne({ where, attributes: ["id"], transaction })
  if (taken) throw new ConflictError(PIN_TAKEN_MESSAGE)
}
