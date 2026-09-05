import { Op, UniqueConstraintError } from "sequelize"
import { User } from "./user.model.js"
import { Location } from "../locations/location.model.js"
import { Order } from "../orders/order.model.js"
import { publicUser } from "./auth.service.js"
import { hashPassword } from "../../shared/utils/hash.util.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"

const LISTABLE_ROLES = ["store_admin", "manager", "cashier"]
const CREATABLE_ROLES = ["manager", "cashier"]

function staffWhere(actor) {
  const where = {
    store_id: actor.store_id,
    role: { [Op.in]: LISTABLE_ROLES },
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

async function resolveLocation(storeId, locationId) {
  if (!locationId) throw new AppError("location_id is required", 400)
  const location = await Location.findOne({
    where: { id: locationId, store_id: storeId, is_active: true },
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

async function assertPinFree(storeId, pin, exceptId) {
  const where = { store_id: storeId, pin }
  if (exceptId) where.id = { [Op.ne]: exceptId }
  const taken = await User.findOne({ where })
  if (taken) throw new ConflictError("PIN is already used in this store")
}

export async function listStaff(actor) {
  const rows = await User.findAll({
    where: staffWhere(actor),
    order: [
      ["role", "ASC"],
      ["created_at", "ASC"],
    ],
  })
  return rows.map(publicUser)
}

export async function getStaff(actor, id) {
  return publicUser(await findVisibleStaff(actor, id))
}

export async function createStaff(actor, input) {
  if (!CREATABLE_ROLES.includes(input.role)) {
    throw new AppError("role must be manager or cashier", 400)
  }

  let location
  if (actor.role === "manager") {
    if (input.location_id && input.location_id !== actor.location_id) {
      throw new ForbiddenError("Managers can only add staff at their location")
    }
    location = await resolveLocation(actor.store_id, actor.location_id)
  } else {
    location = await resolveLocation(actor.store_id, input.location_id)
  }

  await assertEmailFree(actor.store_id, input.email)
  await assertPinFree(actor.store_id, input.pin)

  try {
    const user = await User.create({
      store_id: actor.store_id,
      store_id_int: actor.store_id_int,
      location_id: location.id,
      location_id_int: location.location_id_int,
      name: input.name,
      email: input.email,
      password: await hashPassword(input.password),
      pin: input.pin,
      phone: input.phone,
      role: input.role,
      is_verified: true,
      is_active: true,
    })
    return publicUser(user)
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      const fields = err.errors?.map((e) => e.path) || []
      if (fields.includes("pin")) {
        throw new ConflictError("PIN is already used in this store")
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
  if (fields.pin) {
    await assertPinFree(actor.store_id, fields.pin, user.id)
    patch.pin = fields.pin
  }
  if (fields.location_id) {
    if (actor.role === "manager" && fields.location_id !== actor.location_id) {
      throw new ForbiddenError("Managers cannot move staff to another location")
    }
    const location = await resolveLocation(actor.store_id, fields.location_id)
    patch.location_id = location.id
    patch.location_id_int = location.location_id_int
  }

  try {
    await user.update(patch)
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new ConflictError("PIN or email is already used in this store")
    }
    throw err
  }

  return publicUser(user)
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
    staff: publicUser(staff),
    orders,
  }
}
