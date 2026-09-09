import { Op } from "sequelize"
import { RegisterSession } from "./registerSession.model.js"
import { PosDevice } from "./posDevice.model.js"
import { getLocation } from "../locations/location.service.js"
import { getStoreForManager, getStorePlan } from "../stores/store.service.js"
import { planHasFeature } from "../plans/plan.service.js"
import { money } from "../commerce/pricing.service.js"
import { writeAudit } from "../../shared/utils/audit.util.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

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

function publicSession(row) {
  const json = row.toJSON ? row.toJSON() : row
  const expected = expectedCash(json)
  const { store_id_int, location_id_int, ...rest } = json
  return {
    ...rest,
    store_number: store_id_int,
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

async function resolveDevice(storeId, locationId, deviceId) {
  if (!deviceId) return null
  const device = await PosDevice.findOne({
    where: { id: deviceId, store_id: storeId, is_active: true },
  })
  if (!device) throw new NotFoundError("Device not found")
  if (device.location_id !== locationId) {
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
    status: "clock_in",
  }
  if (query.device_id) where.device_id = query.device_id
  if (actor.role === "cashier") where.cashier_id = actor.id
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

export async function clockIn(actor, fields) {
  const store = await getStoreForManager(actor.store_id)
  const locationId = resolveActorLocation(actor, fields.location_id)
  if (!locationId) throw new AppError("location_id is required", 400)
  const location = await getLocation(store.id, locationId)
  const device = await resolveDevice(store.id, location.id, fields.device_id)
  const plan = await getStorePlan(store)

  const openWhere = {
    store_id: store.id,
    location_id: location.id,
    status: "clock_in",
  }
  if (planHasFeature(plan, "multi_branch_enabled") && device) openWhere.device_id = device.id

  const open = await RegisterSession.findOne({ where: openWhere })
  if (open) {
    throw new ConflictError("A register session is already open")
  }

  const row = await RegisterSession.create({
    store_id: store.id,
    store_id_int: store.store_id_int,
    location_id: location.id,
    location_id_int: location.location_id_int,
    cashier_id: actor.id,
    device_id: device?.id || null,
    status: "clock_in",
    opening_cash: fields.opening_cash,
    expected_cash: money(fields.opening_cash),
    note: fields.note,
    opened_at: new Date(),
  })

  await writeAudit({
    action: "clock_in",
    entity_type: "register_sessions",
    entity_id: row.id,
    store_id: store.id,
    store_id_int: store.store_id_int,
    location_id: location.id,
    location_id_int: location.location_id_int,
    user_id: actor.id,
    channel: "pos",
  })

  return publicSession(row)
}

export async function clockOut(actor, id, fields) {
  const row = await getSession(actor.store_id, id)
  if (row.status !== "clock_in") {
    throw new ConflictError("Session is already closed")
  }
  if (actor.role === "cashier" && row.cashier_id !== actor.id) {
    throw new ForbiddenError("You can only close your own session")
  }
  if (actor.role === "manager" && row.location_id !== actor.location_id) {
    throw new ForbiddenError("You can only close a session at your location")
  }

  const counted =
    fields.counted_cash != null ? money(fields.counted_cash) : countedFromNotes(fields)
  const closing = fields.closing_cash != null ? money(fields.closing_cash) : counted
  const expected = expectedCash(row)
  const variance = money(closing - expected)

  await row.update({
    ...fields,
    counted_cash: counted,
    closing_cash: closing,
    expected_cash: expected,
    cash_variance: variance,
    status: "clock_out",
    closed_at: new Date(),
  })

  await writeAudit({
    action: "clock_out",
    entity_type: "register_sessions",
    entity_id: row.id,
    store_id: row.store_id,
    store_id_int: row.store_id_int,
    location_id: row.location_id,
    location_id_int: row.location_id_int,
    user_id: actor.id,
    channel: "pos",
    note: `variance ${variance}`,
  })

  return publicSession(row)
}

export async function requireOpenSession(
  storeId,
  { locationId, deviceId, sessionId },
  { transaction } = {}
) {
  if (sessionId) {
    const row = await RegisterSession.findOne({
      where: { id: sessionId, store_id: storeId },
      transaction,
    })
    if (!row) throw new NotFoundError("Register session not found")
    if (row.status !== "clock_in") {
      throw new ConflictError("Register session is closed")
    }
    if (locationId && row.location_id !== locationId) {
      throw new AppError("Session is not at this location", 400)
    }
    return row
  }

  const where = {
    store_id: storeId,
    location_id: locationId,
    status: "clock_in",
  }
  if (deviceId) where.device_id = deviceId
  const row = await RegisterSession.findOne({
    where,
    order: [["opened_at", "DESC"]],
    transaction,
  })
  if (!row) {
    throw new ConflictError("Clock in before selling")
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
  await session.update(patch, { transaction })
}
