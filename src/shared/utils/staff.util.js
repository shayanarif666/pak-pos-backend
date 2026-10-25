import { Op } from "sequelize"
import { User } from "../../modules/auth/user.model.js"
import { NotFoundError } from "../errors/NotFoundError.js"
import { AppError } from "../errors/AppError.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STAFF_ROLES = ["store_admin", "manager", "cashier"]

/** First present value among `keys` in body (staff_id / staffId by default). */
export function staffRefFrom(body, keys = ["staff_id", "staffId"]) {
  if (!body || typeof body !== "object") return null
  for (const key of keys) {
    const value = body[key]
    if (value !== undefined && value !== null && value !== "") return String(value).trim()
  }
  return null
}

/**
 * Who did the work. Only a store admin or manager holds a token; a cashier is picked by PIN on
 * the till and the POS sends their staff id (user number, e.g. 3, or UUID). Without one, the
 * token's own user is the staff member.
 */
export async function resolveStaff(storeId, ref, fallbackUser) {
  if (!ref) return fallbackUser
  const where = { store_id: storeId, is_active: true, role: { [Op.in]: STAFF_ROLES } }
  if (/^\d+$/.test(ref)) where.user_number = Number(ref)
  else if (UUID_RE.test(ref)) where.id = ref
  else throw new AppError("staff_id must be the staff member's number or UUID", 400)
  const staff = await User.findOne({ where })
  if (!staff) throw new NotFoundError("Staff member not found")
  return staff
}

/**
 * The request actor with the staff member as the one acting: ids written as cashier_id /
 * staff_id / created_by become the staff member's, while the store and location stay the
 * request's (token, or the store admin's chosen location_id).
 */
export function actingAs(actor, staff) {
  if (!staff || staff.id === actor.id) return actor
  return {
    ...actor,
    id: staff.id,
    name: staff.name,
    email: staff.email,
    phone: staff.phone,
    role: staff.role,
    user_number: staff.user_number,
  }
}
