import { AppError } from "../../shared/errors/AppError.js"
import { CASH_MOVEMENT_PARTY, CASH_MOVEMENT_TYPE } from "../../db/enums.js"

const present = (value) => value !== undefined && value !== null && String(value).trim() !== ""
const firstOf = (body, keys) => keys.map((key) => body?.[key]).find((value) => value !== undefined)

/** pay_in | pay_out ("Pay In", "pay-out", "in" and "out" are read the same). */
function parseType(raw) {
  const text = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")
  const type = text === "in" || text === "payin" ? "pay_in" : text === "out" || text === "payout" ? "pay_out" : text
  if (!CASH_MOVEMENT_TYPE.includes(type)) throw new AppError("type must be pay_in or pay_out", 400)
  return type
}

function parseAmount(raw) {
  const value = Number(raw)
  if (!present(raw) || Number.isNaN(value) || value <= 0) throw new AppError("amount must be a number above 0", 400)
  return Math.round(value * 100) / 100
}

function parseText(raw, key, { max, required = false }) {
  if (!present(raw)) {
    if (required) throw new AppError(`${key} is required`, 400)
    return null
  }
  const text = String(raw).trim()
  if (text.length > max) throw new AppError(`${key} is too long (${max} characters at most)`, 400)
  return text
}

/** A number (1, 2, 3…) or a UUID, as text; null when cleared; undefined when not sent. */
function parseRef(body, keys, label) {
  const raw = firstOf(body, keys)
  if (raw === undefined) return undefined
  if (!present(raw)) return null
  const text = String(raw).trim()
  if (!/^[1-9][0-9]*$/.test(text) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
    throw new AppError(`${label} must be a number (1, 2, 3…) or a UUID`, 400)
  }
  return text
}

function parseParty(body, fields) {
  const rawType = firstOf(body, ["party_type", "partyType"])
  if (rawType !== undefined) {
    if (!present(rawType)) fields.party_type = null
    else {
      const type = String(rawType).trim().toLowerCase()
      if (!CASH_MOVEMENT_PARTY.includes(type)) throw new AppError(`party_type must be one of: ${CASH_MOVEMENT_PARTY.join(", ")}`, 400)
      fields.party_type = type
    }
  }
  const partyId = parseRef(body, ["party_id", "partyId"], "party_id")
  if (partyId !== undefined) fields.party_id = partyId
  const partyName = firstOf(body, ["party_name", "partyName"])
  if (partyName !== undefined) fields.party_name = parseText(partyName, "party_name", { max: 255 })
}

function parseDate(raw) {
  if (!present(raw)) return null
  const at = new Date(raw)
  if (Number.isNaN(at.getTime())) throw new AppError("occurred_at must be a date-time", 400)
  return at
}

function parseRefs(body, fields) {
  for (const [key, keys, label] of [
    ["from_user", ["from_user", "fromUser", "from_user_id"], "from_user"],
    ["to_user", ["to_user", "toUser", "to_user_id"], "to_user"],
    ["device_id", ["device_id", "deviceId"], "device_id"],
    ["batch_id", ["batch_id", "batchId"], "batch_id"],
    ["staff_id", ["staff_id", "staffId"], "staff_id"],
  ]) {
    const value = parseRef(body, keys, label)
    if (value !== undefined) fields[key] = value
  }
}

/**
 * One Pay In / Pay Out of POST /cash-movements(/bulk): type, amount and reason are needed; party_*,
 * from_user / to_user (staff numbers), device_id (device number), batch_id (batch number),
 * staff_id, occurred_at (default now), attachment_url and local_id are optional.
 */
export function parseCreateCashMovement(body = {}) {
  const fields = {
    type: parseType(body.type),
    amount: parseAmount(body.amount),
    reason: parseText(body.reason, "reason", { max: 2000, required: true }),
    occurred_at: parseDate(firstOf(body, ["occurred_at", "occurredAt"])),
    attachment_url: parseText(firstOf(body, ["attachment_url", "attachmentUrl"]), "attachment_url", { max: 1024 }),
    client_local_id: parseText(firstOf(body, ["local_id", "client_local_id", "localId"]), "local_id", { max: 128 }),
    location_id: body.location_id || null,
  }
  parseParty(body, fields)
  parseRefs(body, fields)
  return fields
}

/** PATCH: any field of the create; only what is sent changes. */
export function parsePatchCashMovement(body = {}) {
  const fields = {}
  if (body.type !== undefined) fields.type = parseType(body.type)
  if (body.amount !== undefined) fields.amount = parseAmount(body.amount)
  if (body.reason !== undefined) fields.reason = parseText(body.reason, "reason", { max: 2000, required: true })
  const occurred = firstOf(body, ["occurred_at", "occurredAt"])
  if (occurred !== undefined) {
    if (!present(occurred)) throw new AppError("occurred_at must be a date-time", 400)
    fields.occurred_at = parseDate(occurred)
  }
  const attachment = firstOf(body, ["attachment_url", "attachmentUrl"])
  if (attachment !== undefined) fields.attachment_url = parseText(attachment, "attachment_url", { max: 1024 })
  parseParty(body, fields)
  parseRefs(body, fields)
  if (!Object.keys(fields).length) {
    throw new AppError("Send at least one of type, amount, reason, party_type, party_id, party_name, from_user, to_user, occurred_at, attachment_url, batch_id, device_id, staff_id", 400)
  }
  return fields
}
