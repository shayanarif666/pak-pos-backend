import { Op } from "sequelize"
import { StaffSession } from "./staffSession.model.js"
import { Location } from "../locations/location.model.js"
import { getStoreForManager } from "../stores/store.service.js"
import { writeAudit } from "../../shared/utils/audit.util.js"
import { nextStaffSessionNumber } from "../../shared/utils/counter.util.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { AppError } from "../../shared/errors/AppError.js"
import { User } from "../auth/user.model.js"

/** POS shape: { id, staffId, status, opening_at | closing_at } with short numbers. */
async function publicStaffSession(row, staff) {
  const location = row.location_id ? await Location.findByPk(row.location_id, { attributes: ["location_id_int", "name"] }) : null
  const base = {
    id: row.session_number,
    staff: { id: staff.user_number, name: staff.name, role: staff.role },
    location: location ? { id: location.location_id_int, name: location.name } : null,
    status: row.status,
  }
  return row.status === "clock_in"
    ? { ...base, opening_at: row.clock_in_at }
    : { ...base, closing_at: row.clock_out_at }
}

async function audit(action, row, staff) {
  await writeAudit({
    action,
    entity_type: "staff_sessions",
    entity_id: row.id,
    store_id: row.store_id,
    store_id_int: row.store_id_int,
    location_id: row.location_id,
    location_id_int: row.location_id_int,
    user_id: staff.id,
    channel: "pos",
  })
}

/**
 * Clock in: starts the staff member's attendance at the request's location (token, or the store
 * admin's location_id). A staff member can be clocked in only once at a time.
 */
export async function clockIn(actor, staff, { clocked_at = null } = {}) {
  const store = await getStoreForManager(actor.store_id)
  const open = await StaffSession.findOne({
    where: { store_id: store.id, user_id: staff.id, status: "clock_in" },
  })
  if (open) throw new ConflictError("This staff member is already clocked in")

  const locationId = actor.location_id || staff.location_id || null
  const location = locationId
    ? await Location.findOne({
        where: { id: locationId, store_id: store.id },
        attributes: ["id", "location_id_int"],
      })
    : null

  const row = await StaffSession.create({
    store_id: store.id,
    store_id_int: store.store_id_int,
    session_number: await nextStaffSessionNumber(store.id),
    location_id: location?.id || null,
    location_id_int: location?.location_id_int ?? null,
    user_id: staff.id,
    device_id: actor.device_id || null,
    status: "clock_in",
    clock_in_at: clocked_at || new Date(),
  })
  await audit("clock_in", row, staff)
  return publicStaffSession(row, staff)
}

/** Clock out: ends the staff member's open attendance session. */
export async function clockOut(actor, staff, { clocked_at = null } = {}) {
  const row = await StaffSession.findOne({
    where: { store_id: actor.store_id, user_id: staff.id, status: "clock_in" },
    order: [["clock_in_at", "DESC"]],
  })
  if (!row) throw new NotFoundError("This staff member is not clocked in")
  await row.update({ status: "clock_out", clock_out_at: clocked_at || new Date() })
  await audit("clock_out", row, staff)
  return publicStaffSession(row, staff)
}

/** Whether each user is on duty right now: Map(user_id -> "clock_in" | "clock_out"). */
export async function clockStatusOf(storeId, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (!ids.length) return new Map()
  const rows = await StaffSession.findAll({
    where: { store_id: storeId, user_id: { [Op.in]: ids }, status: "clock_in" },
    attributes: ["user_id"],
  })
  const on = new Set(rows.map((row) => row.user_id))
  return new Map(ids.map((id) => [id, on.has(id) ? "clock_in" : "clock_out"]))
}

/**
 * A manager corrects an attendance row: clock_in_at / clock_out_at (e.g. the cashier forgot to
 * clock out). Setting clock_out_at closes the session. A manager only at their own location.
 */
export async function updateStaffSession(actor, id, fields) {
  const row = await StaffSession.findOne({ where: { id, store_id: actor.store_id } })
  if (!row) throw new NotFoundError("Staff session not found")
  if (actor.role !== "store_admin" && row.location_id && row.location_id !== actor.location_id) {
    throw new NotFoundError("Staff session not found")
  }
  const dateOf = (key) => {
    if (fields[key] === undefined) return undefined
    const date = new Date(fields[key])
    if (fields[key] === null || Number.isNaN(date.getTime())) throw new AppError(`${key} must be a date-time`, 400)
    return date
  }
  const clockIn = dateOf("clock_in_at")
  const clockOut = dateOf("clock_out_at")
  if (clockIn === undefined && clockOut === undefined) throw new AppError("Send clock_in_at and / or clock_out_at", 400)
  const start = clockIn ?? row.clock_in_at
  const end = clockOut ?? row.clock_out_at
  if (end && start && new Date(end) <= new Date(start)) throw new AppError("clock_out_at must be after clock_in_at", 400)

  await row.update({
    ...(clockIn ? { clock_in_at: clockIn } : {}),
    ...(clockOut ? { clock_out_at: clockOut, status: "clock_out" } : {}),
  })
  const staff = await User.findByPk(row.user_id, { attributes: ["id", "user_number", "name", "role"] })
  await writeAudit({
    action: "update",
    entity_type: "staff_sessions",
    entity_id: row.id,
    store_id: row.store_id,
    store_id_int: row.store_id_int,
    location_id: row.location_id,
    location_id_int: row.location_id_int,
    user_id: actor.id,
    channel: "pos",
  })
  return publicStaffSession(row, staff)
}

/** A session by its UUID or session number, visible to the actor (a manager: their location). */
async function visibleSession(actor, ref) {
  const value = String(ref ?? "").trim()
  const where = /^\d+$/.test(value) ? { store_id: actor.store_id, session_number: Number(value) } : { store_id: actor.store_id, id: value }
  const row = await StaffSession.findOne({ where })
  if (!row || (actor.role !== "store_admin" && row.location_id && row.location_id !== actor.location_id)) {
    throw new NotFoundError("Staff session not found")
  }
  return row
}

/** PATCH /staff-sessions/:id — clock_in_at / clock_out_at (session number or UUID). */
export async function updateStaffSessionByRef(actor, ref, fields) {
  const row = await visibleSession(actor, ref)
  return updateStaffSession(actor, row.id, fields)
}

/** DELETE /staff-sessions/:id — soft delete: the row stays, lists and reports leave it out. */
export async function deleteStaffSession(actor, ref) {
  const row = await visibleSession(actor, ref)
  await row.destroy()
  await writeAudit({
    action: "delete",
    entity_type: "staff_sessions",
    entity_id: row.id,
    store_id: row.store_id,
    store_id_int: row.store_id_int,
    location_id: row.location_id,
    location_id_int: row.location_id_int,
    user_id: actor.id,
    channel: "web",
    note: `session #${row.session_number} deleted (soft)`,
  })
  return { id: row.session_number, deleted: true }
}
