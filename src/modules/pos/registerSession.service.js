import { Op } from "sequelize"
import { RegisterSession } from "./registerSession.model.js"
import { PosDevice } from "./posDevice.model.js"
import { getLocation } from "../locations/location.service.js"
import { getStoreForManager } from "../stores/store.service.js"
import { money } from "../commerce/pricing.service.js"
import { writeAudit } from "../../shared/utils/audit.util.js"
import { StaffSession } from "./staffSession.model.js"
import { nextSessionNumber } from "../../shared/utils/counter.util.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { Location } from "../locations/location.model.js"

const NOTE_VALUES = [
  ["note_5000_count", 5000],
  ["note_1000_count", 1000],
  ["note_500_count", 500],
  ["note_100_count", 100],
  ["note_50_count", 50],
  ["note_20_count", 20],
]

function expectedCash(row) {
  return money(
    Number(row.opening_cash) +
      Number(row.cash_in) +
      Number(row.cash_sales) -
      Number(row.cash_out)
  )
}

function countedFromNotes(fields) {
  let total = Number(fields.coins_total || 0)
  for (const [key, face] of NOTE_VALUES) {
    total += Number(fields[key] || 0) * face
  }
  return money(total)
}

const staffSummary = (staff) => ({ id: staff.user_number, name: staff.name, role: staff.role })

/** location { id, name } of a batch (POS replies). */
async function batchLocation(row) {
  const location = row.location_id ? await Location.findByPk(row.location_id, { attributes: ["location_id_int", "name"] }) : null
  return { location: location ? { id: location.location_id_int, name: location.name } : null }
}

function publicSession(row) {
  const json = row.toJSON ? row.toJSON() : row
  const expected = expectedCash(json)
  const { store_id_int, location_id_int, ...rest } = json
  return {
    ...rest,
    store_id: json.store_id,
    store_number: store_id_int,
    location_id: json.location_id,
    location_number: location_id_int,
    opening_cash: Number(json.opening_cash),
    cash_in: Number(json.cash_in),
    cash_out: Number(json.cash_out),
    cash_sales: Number(json.cash_sales),
    card_sales: Number(json.card_sales),
    jazzcash_sales: Number(json.jazzcash_sales),
    easypaisa_sales: Number(json.easypaisa_sales),
    total_sales: Number(json.total_sales),
    net_sales: Number(json.net_sales),
    expected_cash: expected,
    counted_cash: json.counted_cash == null ? null : Number(json.counted_cash),
    closing_cash: json.closing_cash == null ? null : Number(json.closing_cash),
    cash_variance: json.cash_variance == null ? null : Number(json.cash_variance),
    coins_total: json.coins_total == null ? null : Number(json.coins_total),
  }
}

function resolveActorLocation(actor, requested) {
  if (actor.role === "store_admin") return requested || actor.location_id
  return actor.location_id
}

async function getSession(storeId, id) {
  const row = await RegisterSession.findOne({
    where: { id, store_id: storeId },
  })
  if (!row) throw new NotFoundError("Register session not found")
  return row
}

// Clock-out can target a session by its UUID id or its short session_number — whichever the
// till has on hand.
async function getSessionByIdOrNumber(storeId, idOrNumber) {
  const isNumber = /^\d+$/.test(String(idOrNumber))
  const where = isNumber
    ? { session_number: Number(idOrNumber), store_id: storeId }
    : { id: idOrNumber, store_id: storeId }
  const row = await RegisterSession.findOne({ where })
  if (!row) throw new NotFoundError("Register session not found")
  return row
}

async function resolveDevice(storeId, locationId, { deviceId, deviceUid } = {}) {
  if (!deviceId && !deviceUid) return null
  const where = { store_id: storeId, is_active: true }
  if (deviceId && deviceUid) {
    where[Op.or] = [{ id: deviceId }, { device_uid: deviceUid }]
  } else if (deviceId) {
    // deviceId isn't guaranteed to be the pos_devices row id — it may be the device_uid sent
    // under the wrong key, so match either column.
    where[Op.or] = [{ id: deviceId }, { device_uid: deviceId }]
  } else {
    where.device_uid = deviceUid
  }
  const device = await PosDevice.findOne({ where })
  if (!device) throw new NotFoundError("Device not found")
  // A till with no branch yet can open a shift at the cashier's location.
  if (device.location_id && device.location_id !== locationId) {
    throw new AppError("Device is not at this location", 400)
  }
  return device
}

export async function listSessions(actor, query = {}) {
  const where = { store_id: actor.store_id }
  if (actor.role !== "store_admin") where.location_id = actor.location_id
  else if (query.location_id || query.locationId) {
    where.location_id = query.location_id || query.locationId
  }
  if (query.status) where.status = query.status
  if (query.from || query.to) {
    where.opened_at = {}
    if (query.from) where.opened_at[Op.gte] = new Date(query.from)
    if (query.to) where.opened_at[Op.lte] = new Date(query.to)
  }
  const rows = await RegisterSession.findAll({
    where,
    order: [["opened_at", "DESC"]],
  })
  return rows.map(publicSession)
}

export async function getCurrentSession(actor, query = {}) {
  const locationId = resolveActorLocation(actor, query.location_id)
  if (!locationId) throw new AppError("location_id is required", 400)
  const where = {
    store_id: actor.store_id,
    location_id: locationId,
    status: "open",
  }
  // "Current" is the caller's own drawer (or the given counter's), never another cashier's.
  if (query.device_id) where.device_id = query.device_id
  else where.cashier_id = actor.id
  const row = await RegisterSession.findOne({
    where,
    order: [["opened_at", "DESC"]],
  })
  return row ? publicSession(row) : null
}

export async function getSessionView(actor, id) {
  const row = await getSession(actor.store_id, id)
  if (actor.role !== "store_admin" && row.location_id !== actor.location_id) {
    throw new NotFoundError("Register session not found")
  }
  return publicSession(row)
}

/**
 * Batch opening (cash drawer) for a staff member. `actor` is the signed-in admin / manager whose
 * token gives the store and location; `staff` is who the batch belongs to (the cashier picked by
 * PIN, or the actor themself).
 */
export async function openBatch(actor, staff, fields) {
  const store = await getStoreForManager(actor.store_id)
  const locationId = resolveActorLocation(actor, fields.location_id)
  if (!locationId) throw new AppError("location_id is required", 400)
  const location = await getLocation(store.id, locationId)
  const device = await resolveDevice(store.id, location.id, {
    deviceId: fields.device_id || actor.device_id || null,
    deviceUid: fields.device_uid || null,
  })

  // One open batch per staff member, and per counter (device) when the till is known.
  const openForStaff = await RegisterSession.findOne({
    where: { store_id: store.id, cashier_id: staff.id, status: "open" },
  })
  if (openForStaff) {
    throw new ConflictError("This staff member already has an open batch")
  }
  if (device) {
    const openOnDevice = await RegisterSession.findOne({
      where: { store_id: store.id, device_id: device.id, status: "open" },
    })
    if (openOnDevice) {
      throw new ConflictError("This counter already has an open batch")
    }
  }

  // The staff member's current attendance session, if they clocked in.
  const staffSession = await StaffSession.findOne({
    where: { store_id: store.id, user_id: staff.id, status: "clock_in" },
    order: [["clock_in_at", "DESC"]],
  })

  const row = await RegisterSession.create({
    store_id: store.id,
    store_id_int: store.store_id_int,
    session_number: await nextSessionNumber(store.id),
    location_id: location.id,
    location_id_int: location.location_id_int,
    cashier_id: staff.id,
    device_id: device?.id || null,
    staff_session_id: staffSession?.id || null,
    status: "open",
    opening_cash: fields.opening_cash,
    expected_cash: money(fields.opening_cash),
    note: fields.note,
    opened_at: fields.opened_at || new Date(),
  })

  await writeAudit({
    action: "create",
    entity_type: "register_sessions",
    entity_id: row.id,
    store_id: store.id,
    store_id_int: store.store_id_int,
    location_id: location.id,
    location_id_int: location.location_id_int,
    user_id: staff.id,
    channel: "pos",
    note: "batch opened",
  })

  return {
    id: row.session_number,
    staff: staffSummary(staff),
    ...(await batchLocation(row)),
    opening_amount: Number(row.opening_cash),
    opening_at: row.opened_at,
  }
}

/**
 * Batch closing: closes the staff member's open batch (or the one given by batch_id). total_cash
 * is the cash counted in the drawer; note counts may be sent instead.
 */
export async function closeBatch(actor, staff, fields) {
  let row
  if (fields.batch_id) {
    row = await getSessionByIdOrNumber(actor.store_id, fields.batch_id)
  } else {
    row = await RegisterSession.findOne({
      where: { store_id: actor.store_id, cashier_id: staff.id, status: "open" },
      order: [["opened_at", "DESC"]],
    })
    if (!row) throw new NotFoundError("This staff member has no open batch")
  }
  if (row.status !== "open") {
    throw new ConflictError("This batch is already closed")
  }

  const counted =
    fields.total_cash != null ? money(fields.total_cash) : countedFromNotes(fields)
  const closing = fields.closing_cash != null ? money(fields.closing_cash) : counted
  const expected = expectedCash(row)
  const variance = money(closing - expected)

  const { batch_id: _batch, total_cash: _total, ...rest } = fields
  await row.update({
    ...rest,
    counted_cash: counted,
    closing_cash: closing,
    expected_cash: expected,
    cash_variance: variance,
    status: "closed",
    closed_at: fields.closed_at || new Date(),
  })

  await writeAudit({
    action: "update",
    entity_type: "register_sessions",
    entity_id: row.id,
    store_id: row.store_id,
    store_id_int: row.store_id_int,
    location_id: row.location_id,
    location_id_int: row.location_id_int,
    user_id: staff.id,
    channel: "pos",
    note: `batch closed, variance ${variance}`,
  })

  return {
    id: row.session_number,
    staff: staffSummary(staff),
    ...(await batchLocation(row)),
    total_cash: Number(row.counted_cash),
    closing_at: row.closed_at,
  }
}

// DATETIME columns are stored to the second, so allow a small edge on both ends.
const SHIFT_EDGE_MS = 2000

function coversTime(row, at) {
  if (!at) return false
  const time = new Date(at).getTime()
  const opened = new Date(row.opened_at).getTime() - SHIFT_EDGE_MS
  const closed = row.closed_at ? new Date(row.closed_at).getTime() + SHIFT_EDGE_MS : Infinity
  return time >= opened && time <= closed
}

/**
 * The shift a POS sale belongs to.
 * - Live sale: the seller's own open shift (by device when known, otherwise by cashier).
 * - Offline sale (placedAt in the past): the seller's shift that was open at placedAt,
 *   even if it has been closed since the sale was made.
 */
export async function requireOpenSession(
  storeId,
  { locationId, deviceId, sessionId, cashierId, actorRole, placedAt, offline = false },
  { transaction } = {}
) {
  if (sessionId) {
    const row = await RegisterSession.findOne({
      where: { id: sessionId, store_id: storeId },
      transaction,
    })
    if (!row) throw new NotFoundError("Register session not found")
    if (actorRole === "cashier" && cashierId && row.cashier_id !== cashierId) {
      throw new ForbiddenError("This register session belongs to another cashier")
    }
    if (row.status !== "open" && !(offline && coversTime(row, placedAt))) {
      throw new ConflictError("This batch is closed")
    }
    if (locationId && row.location_id !== locationId) {
      throw new AppError("Session is not at this location", 400)
    }
    return row
  }

  const base = { store_id: storeId, location_id: locationId }
  const owner = deviceId ? { device_id: deviceId } : { cashier_id: cashierId }

  let row = await RegisterSession.findOne({
    where: { ...base, ...owner, status: "open" },
    order: [["opened_at", "DESC"]],
    transaction,
  })
  if (!row && deviceId && cashierId) {
    row = await RegisterSession.findOne({
      where: { ...base, cashier_id: cashierId, status: "open" },
      order: [["opened_at", "DESC"]],
      transaction,
    })
  }
  if (!row && offline && placedAt) {
    const candidates = await RegisterSession.findAll({
      where: { ...base, cashier_id: cashierId, opened_at: { [Op.lte]: new Date(placedAt) } },
      order: [["opened_at", "DESC"]],
      limit: 5,
      transaction,
    })
    row = candidates.find((candidate) => coversTime(candidate, placedAt)) || null
  }
  if (!row) {
    throw new ConflictError("Open a batch before selling")
  }
  return row
}

const METHOD_FIELD = {
  cash: "cash_sales",
  card: "card_sales",
  jazzcash: "jazzcash_sales",
  easypaisa: "easypaisa_sales",
}

export async function applySessionSale(session, { payments, total, reverse = false }, { transaction }) {
  if (!session) return
  const sign = reverse ? -1 : 1
  const patch = {
    total_sales: money(Number(session.total_sales) + sign * Number(total)),
    net_sales: money(Number(session.net_sales) + sign * Number(total)),
  }
  for (const payment of payments || []) {
    const field = METHOD_FIELD[payment.method]
    if (!field) continue
    patch[field] = money(Number(session[field] || 0) + sign * Number(payment.amount))
  }
  patch.expected_cash = money(
    Number(session.opening_cash) +
      Number(session.cash_in) +
      Number(patch.cash_sales ?? session.cash_sales) -
      Number(session.cash_out)
  )
  // An offline sale synced after clock-out changes what the drawer should have held.
  if (session.status === "closed" && session.closing_cash != null) {
    patch.cash_variance = money(Number(session.closing_cash) - patch.expected_cash)
  }
  await session.update(patch, { transaction })
}

const MONEY_FIELDS = ["opening_cash", "cash_in", "cash_out", "counted_cash"]

/** A batch by session number or UUID, visible to the actor (a manager / cashier: their location). */
async function visibleBatch(actor, ref) {
  const row = await getSessionByIdOrNumber(actor.store_id, ref)
  if (actor.role !== "store_admin" && row.location_id !== actor.location_id) {
    throw new NotFoundError("Register session not found")
  }
  return row
}

/**
 * Corrects a batch: opening_cash, cash_in, cash_out, counted_cash (closed batch), opened_at,
 * closed_at (closed batch), note. Expected cash and the variance are worked out again.
 */
export async function updateBatch(actor, ref, input = {}) {
  const row = await visibleBatch(actor, ref)
  const patch = {}
  for (const key of MONEY_FIELDS) {
    const raw = input[key] ?? (key === "counted_cash" ? input.total_cash : undefined)
    if (raw === undefined) continue
    const value = Number(raw)
    if (raw === null || raw === "" || Number.isNaN(value) || value < 0) throw new AppError(`${key} must be a number >= 0`, 400)
    if (key === "counted_cash" && row.status !== "closed") throw new AppError("counted_cash is set when the batch is closed", 400)
    patch[key] = money(value)
  }
  for (const key of ["opened_at", "closed_at"]) {
    if (input[key] === undefined) continue
    const date = new Date(input[key])
    if (input[key] === null || Number.isNaN(date.getTime())) throw new AppError(`${key} must be a date-time`, 400)
    if (key === "closed_at" && row.status !== "closed") throw new AppError("closed_at is set when the batch is closed", 400)
    patch[key] = date
  }
  if (input.note !== undefined) patch.note = input.note === null ? null : String(input.note).trim() || null
  if (!Object.keys(patch).length) {
    throw new AppError("Send opening_cash, cash_in, cash_out, counted_cash, opened_at, closed_at or note", 400)
  }
  const opened = patch.opened_at ?? row.opened_at
  const closed = patch.closed_at ?? row.closed_at
  const datesEdited = patch.opened_at !== undefined || patch.closed_at !== undefined
  if (datesEdited && closed && opened && new Date(closed) < new Date(opened)) throw new AppError("closed_at must be after opened_at", 400)

  const next = { ...row.toJSON(), ...patch }
  if (row.status === "closed") {
    const expected = expectedCash(next)
    const counted = Number(next.counted_cash ?? 0)
    // The counted cash is what was left in the drawer at closing.
    patch.expected_cash = expected
    if (patch.counted_cash !== undefined) patch.closing_cash = patch.counted_cash
    patch.cash_variance = money(Number(patch.closing_cash ?? next.closing_cash ?? counted) - expected)
  }
  await row.update(patch)
  await writeAudit({
    action: "update",
    entity_type: "register_sessions",
    entity_id: row.id,
    store_id: row.store_id,
    store_id_int: row.store_id_int,
    location_id: row.location_id,
    location_id_int: row.location_id_int,
    user_id: actor.id,
    channel: "web",
    note: `batch #${row.session_number} edited`,
  })
  return publicSession(row)
}

/** Soft delete: the batch leaves lists and reports; its row (and the orders on it) stay. */
export async function deleteBatch(actor, ref) {
  const row = await visibleBatch(actor, ref)
  await row.destroy()
  await writeAudit({
    action: "delete",
    entity_type: "register_sessions",
    entity_id: row.id,
    store_id: row.store_id,
    store_id_int: row.store_id_int,
    location_id: row.location_id,
    location_id_int: row.location_id_int,
    user_id: actor.id,
    channel: "web",
    note: `batch #${row.session_number} deleted (soft)`,
  })
  return { id: row.session_number, deleted: true }
}
