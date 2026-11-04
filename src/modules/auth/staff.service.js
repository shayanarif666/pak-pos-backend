import { Op, UniqueConstraintError } from "sequelize"
import { randomBytes } from "node:crypto"
import { User } from "./user.model.js"
import { Location } from "../locations/location.model.js"
import { Order } from "../orders/order.model.js"
import { publicUser } from "./auth.service.js"
import { hashPassword } from "../../shared/utils/hash.util.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { assertPinAvailable, assertUserPinAvailable, PIN_TAKEN_MESSAGE } from "./pin.util.js"
import { nextUserNumber } from "../../shared/utils/counter.util.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import { StaffSession } from "../pos/staffSession.model.js"
import { writeAudit } from "../../shared/utils/audit.util.js"

const LISTABLE_ROLES = ["store_admin", "manager", "cashier"]
const CREATABLE_ROLES = ["manager", "cashier"]

function staffWhere(actor, { withDeleted = false } = {}) {
  const where = {
    store_id: actor.store_id,
    role: { [Op.in]: LISTABLE_ROLES },
    // Deleted staff stay in the database (their sales and history point at them).
    ...(withDeleted ? {} : { deleted_at: null }),
  }
  if (actor.role === "manager") {
    where.location_id = actor.location_id
    where.role = { [Op.in]: ["manager", "cashier"] }
  }
  return where
}

async function findVisibleStaff(actor, id) {
  const user = await User.findOne({
    where: { ...staffWhere(actor), id },
  })
  if (!user) throw new NotFoundError("Staff not found")
  return user
}

// locationId: the location number (e.g. 1) or its UUID.
async function resolveLocation(storeId, locationId) {
  if (!locationId) throw new AppError("location_id is required", 400)
  const ref = String(locationId)
  const location = await Location.findOne({
    where: {
      ...(/^[0-9]+$/.test(ref) ? { location_id_int: Number(ref) } : { id: ref }),
      store_id: storeId,
      is_active: true,
    },
  })
  if (!location) throw new NotFoundError("Location not found")
  return location
}

async function assertEmailFree(storeId, email, exceptId) {
  const where = { store_id: storeId, email }
  if (exceptId) where.id = { [Op.ne]: exceptId }
  const taken = await User.findOne({ where })
  if (taken) throw new ConflictError("Email already registered in this store")
}

function staffPayload(user, plaintextPassword = null) {
  return {
    ...publicUser(user, { includePin: true }),
    password: plaintextPassword,
    ...(user.deleted_at ? { deleted: true, deleted_at: user.deleted_at } : {}),
  }
}

/** ?include_deleted=1 adds the deleted staff (flagged deleted: true), e.g. to name them in history. */
export async function listStaff(actor, query = {}) {
  const withDeleted = ["1", "true"].includes(String(query.include_deleted ?? ""))
  const rows = await User.findAll({
    where: staffWhere(actor, { withDeleted }),
    order: [
      ["role", "ASC"],
      ["created_at", "ASC"],
    ],
  })
  return rows.map((row) => staffPayload(row))
}

export async function getStaff(actor, id) {
  return staffPayload(await findVisibleStaff(actor, id))
}

export async function createStaff(actor, input) {
  if (!CREATABLE_ROLES.includes(input.role)) {
    throw new AppError("role must be manager or cashier", 400)
  }

  let location
  if (actor.role === "manager") {
    location = await resolveLocation(actor.store_id, actor.location_id)
    // A manager may name their own location (number or UUID), never another one.
    if (input.location_id && (await resolveLocation(actor.store_id, input.location_id)).id !== location.id) {
      throw new ForbiddenError("Managers can only add staff at their location")
    }
  } else {
    location = await resolveLocation(actor.store_id, input.location_id || actor.location_id)
  }

  await assertEmailFree(actor.store_id, input.email)
  await assertPinAvailable(input.pin, {
    storeId: actor.store_id,
    locationId: location.id,
  })

  try {
    const user = await User.create({
      store_id: actor.store_id,
      store_id_int: actor.store_id_int,
      user_number: await nextUserNumber(actor.store_id),
      location_id: location.id,
      location_id_int: location.location_id_int,
      name: input.name,
      email: input.email,
      // No password (a cashier): a random one nobody knows, so the account cannot sign in with one.
      password: await hashPassword(input.password || randomBytes(24).toString("hex")),
      pin: input.pin,
      phone: input.phone,
      role: input.role,
      is_verified: true,
      is_active: true,
    })
    return staffPayload(user, input.password)
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      const fields = err.errors?.map((e) => e.path) || []
      if (fields.includes("pin")) {
        throw new ConflictError(PIN_TAKEN_MESSAGE)
      }
      throw new ConflictError("Email already registered in this store")
    }
    throw err
  }
}

export async function patchStaff(actor, id, fields) {
  const user = await findVisibleStaff(actor, id)

  if (user.role === "store_admin") {
    throw new ForbiddenError("Store admin is edited from My Account")
  }
  if (actor.role === "manager" && user.role === "manager" && user.id !== actor.id) {
    throw new ForbiddenError("Managers cannot edit other managers")
  }

  const patch = {}
  if (fields.name !== undefined) patch.name = fields.name
  if (fields.email !== undefined && fields.email !== user.email) {
    await assertEmailFree(actor.store_id, fields.email, user.id)
    patch.email = fields.email
  }
  if (fields.phone !== undefined) patch.phone = fields.phone
  if (fields.is_active !== undefined) {
    if (user.id === actor.id && fields.is_active === false) {
      throw new AppError("You cannot disable your own account", 400)
    }
    patch.is_active = fields.is_active
  }
  if (fields.role !== undefined) {
    if (actor.role !== "store_admin") {
      throw new ForbiddenError("Only the store admin can change role")
    }
    patch.role = fields.role
  }
  if (fields.password) patch.password = await hashPassword(fields.password)
  if (fields.location_id) {
    if (actor.role === "manager" && fields.location_id !== actor.location_id) {
      throw new ForbiddenError("Managers cannot move staff to another location")
    }
    const location = await resolveLocation(actor.store_id, fields.location_id)
    patch.location_id = location.id
    patch.location_id_int = location.location_id_int
  }
  // PINs are unique per location, so a move re-checks the (new or current) PIN there.
  if (fields.pin || patch.location_id) {
    await assertUserPinAvailable(user, fields.pin || user.pin, { locationId: patch.location_id })
    if (fields.pin) patch.pin = fields.pin
  }

  try {
    await user.update(patch)
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new ConflictError("PIN or email is already in use")
    }
    throw err
  }

  return staffPayload(user, fields.password || null)
}

/**
 * Soft delete: the staff member leaves the list and can no longer sign in or use their PIN (their
 * tokens stop working and an open clock-in is closed); the row, sales and history stay.
 */
export async function deleteStaff(actor, id) {
  const user = await findVisibleStaff(actor, id)
  if (user.role === "store_admin") throw new ForbiddenError("The store admin cannot be deleted")
  if (user.id === actor.id) throw new AppError("You cannot delete your own account", 400)
  if (actor.role === "manager" && user.role === "manager") {
    throw new ForbiddenError("Managers cannot delete other managers")
  }
  const now = new Date()
  await user.update({ deleted_at: now, is_active: false, token_version: Number(user.token_version || 0) + 1 })
  await StaffSession.update(
    { status: "clock_out", clock_out_at: now },
    { where: { store_id: user.store_id, user_id: user.id, status: "clock_in" } }
  )
  await writeAudit({
    action: "delete",
    entity_type: "users",
    entity_id: user.id,
    store_id: user.store_id,
    store_id_int: user.store_id_int,
    location_id: user.location_id,
    location_id_int: user.location_id_int,
    user_id: actor.id,
    channel: "web",
    note: `staff ${user.name} deleted (soft)`,
  })
  return { id: user.user_number, deleted: true }
}

export async function getStaffSales(actor, id, query = {}) {
  const staff = await findVisibleStaff(actor, id)
  const where = {
    store_id: actor.store_id,
    cashier_id: staff.id,
  }
  if (actor.role === "manager") {
    where.location_id = actor.location_id
  }
  if (query.from || query.to) {
    where.placed_at = {}
    if (query.from) where.placed_at[Op.gte] = new Date(query.from)
    if (query.to) where.placed_at[Op.lte] = new Date(query.to)
  }

  const orders = await Order.findAll({
    where,
    attributes: [
      "id",
      "order_number",
      "channel",
      "total_amount",
      "payment_status",
      "order_status",
      "location_id",
      "placed_at",
    ],
    order: [["placed_at", "DESC"]],
  })

  return {
    staff: publicUser(staff, { includePin: true }),
    orders,
  }
}
