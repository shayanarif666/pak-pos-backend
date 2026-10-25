import { AppError } from "../../shared/errors/AppError.js"
import { staffRefFrom } from "../../shared/utils/staff.util.js"

// The staff member the batch belongs to: the POS sends their id (user number) as id / staff_id.
const STAFF_KEYS = ["staff_id", "staffId", "id"]

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function optionalUuid(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  const value = String(body[key])
  if (!UUID_RE.test(value)) throw new AppError(`${key} must be a UUID`, 400)
  return value
}

function optionalInt(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  const n = Number(body[key])
  if (!Number.isInteger(n) || n < 0) {
    throw new AppError(`${key} must be an integer >= 0`, 400)
  }
  return n
}

function optionalNumber(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  const n = Number(body[key])
  if (Number.isNaN(n) || n < 0) throw new AppError(`${key} must be a number >= 0`, 400)
  return n
}

// Lets an offline POS till report when the shift actually opened/closed, instead of the moment
// the sync request happens to reach the server.
function optionalDate(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  const date = new Date(body[key])
  if (Number.isNaN(date.getTime())) throw new AppError(`${key} must be a valid date`, 400)
  return date
}

/** Batch opening: { id (staff), opening_amount }. opening_cash is still read as the old name. */
export function parseOpenBatch(body) {
  const raw = body.opening_amount ?? body.opening_cash
  const opening_cash = Number(raw)
  if (raw === undefined || raw === null || raw === "" || Number.isNaN(opening_cash) || opening_cash < 0) {
    throw new AppError("opening_amount must be a number >= 0", 400)
  }
  return {
    staff_ref: staffRefFrom(body, STAFF_KEYS),
    opening_cash,
    location_id: optionalUuid(body, "location_id"),
    // device_id isn't required to be a UUID here — a client may send either the pos_devices row
    // id or the device's own stable hardware id in this one field, and resolveDevice() matches
    // whichever it turns out to be. device_uid stays as an explicit alternative for clients that
    // already know their hardware id.
    device_id:
      body.device_id == null || body.device_id === "" ? null : String(body.device_id).trim(),
    device_uid:
      body.device_uid == null || body.device_uid === "" ? null : String(body.device_uid).trim(),
    note: body.note == null || body.note === "" ? null : String(body.note).trim(),
    // Offline POS: when this shift actually opened, if that's earlier than when this request
    // reaches the server. Defaults to now when omitted.
    opened_at: optionalDate(body, "opened_at"),
  }
}

/** Batch closing: { id (staff), total_cash }. Note counts may be sent instead of total_cash. */
export function parseCloseBatch(body) {
  const total = body.total_cash ?? body.counted_cash
  return {
    staff_ref: staffRefFrom(body, STAFF_KEYS),
    batch_id:
      body.batch_id == null || body.batch_id === "" ? null : String(body.batch_id).trim(),
    total_cash: total === undefined || total === null || total === "" ? null : optionalNumber({ total }, "total"),
    note_5000_count: optionalInt(body, "note_5000_count"),
    note_1000_count: optionalInt(body, "note_1000_count"),
    note_500_count: optionalInt(body, "note_500_count"),
    note_100_count: optionalInt(body, "note_100_count"),
    note_50_count: optionalInt(body, "note_50_count"),
    note_20_count: optionalInt(body, "note_20_count"),
    coins_total: optionalNumber(body, "coins_total"),
    closing_cash: optionalNumber(body, "closing_cash"),
    note: body.note == null || body.note === "" ? null : String(body.note).trim(),
    // Offline POS: when this shift actually closed (e.g. at day-end), if that's earlier than
    // when this request reaches the server. Defaults to now when omitted.
    closed_at: optionalDate(body, "closed_at"),
  }
}
