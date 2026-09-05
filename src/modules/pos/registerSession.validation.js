import { AppError } from "../../shared/errors/AppError.js"

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

export function parseClockIn(body) {
  const opening_cash = Number(body.opening_cash)
  if (Number.isNaN(opening_cash) || opening_cash < 0) {
    throw new AppError("opening_cash must be a number >= 0", 400)
  }
  return {
    opening_cash,
    location_id: optionalUuid(body, "location_id"),
    device_id: optionalUuid(body, "device_id"),
    note: body.note == null || body.note === "" ? null : String(body.note).trim(),
  }
}

export function parseClockOut(body) {
  return {
    note_5000_count: optionalInt(body, "note_5000_count"),
    note_1000_count: optionalInt(body, "note_1000_count"),
    note_500_count: optionalInt(body, "note_500_count"),
    note_100_count: optionalInt(body, "note_100_count"),
    note_50_count: optionalInt(body, "note_50_count"),
    note_20_count: optionalInt(body, "note_20_count"),
    coins_total: optionalNumber(body, "coins_total"),
    counted_cash: optionalNumber(body, "counted_cash"),
    closing_cash: optionalNumber(body, "closing_cash"),
    note: body.note == null || body.note === "" ? null : String(body.note).trim(),
  }
}
