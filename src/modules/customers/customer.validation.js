import { AppError } from "../../shared/errors/AppError.js"
import { LEDGER_ENTRY_TYPE } from "../../db/enums.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function requireString(body, key, { max = 500 } = {}) {
  const value = body[key]
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError(`${key} is required`, 400)
  }
  const trimmed = value.trim()
  if (trimmed.length > max) throw new AppError(`${key} is too long`, 400)
  return trimmed
}

function optionalString(body, key, { max = 2000 } = {}) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  const trimmed = String(body[key]).trim()
  if (trimmed.length > max) throw new AppError(`${key} is too long`, 400)
  return trimmed
}

function optionalUuid(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  const value = String(body[key])
  if (!UUID_RE.test(value)) throw new AppError(`${key} must be a UUID`, 400)
  return value
}

function optionalNumber(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  const n = Number(body[key])
  if (Number.isNaN(n) || n < 0) throw new AppError(`${key} must be a number >= 0`, 400)
  return n
}

export function parseCreateCustomer(body) {
  return {
    name: requireString(body, "name"),
    email: optionalString(body, "email"),
    phone: optionalString(body, "phone"),
    location_id: optionalUuid(body, "location_id"),
    remaining_debt: optionalNumber(body, "remaining_debt"),
    total_debt: optionalNumber(body, "total_debt"),
    debt_notes: optionalString(body, "debt_notes", { max: 4000 }),
  }
}

export function parsePatchCustomer(body) {
  const patch = {}
  if (body.name !== undefined) patch.name = requireString(body, "name")
  if (body.email !== undefined) patch.email = optionalString(body, "email")
  if (body.phone !== undefined) patch.phone = optionalString(body, "phone")
  if (body.location_id !== undefined) patch.location_id = optionalUuid(body, "location_id")
  if (body.debt_notes !== undefined) patch.debt_notes = optionalString(body, "debt_notes", { max: 4000 })
  if (body.total_debt !== undefined) patch.total_debt = optionalNumber(body, "total_debt")
  if (body.remaining_debt !== undefined) {
    patch.remaining_debt = optionalNumber(body, "remaining_debt")
  }
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active)
  if (!Object.keys(patch).length) throw new AppError("No fields to update", 400)
  return patch
}

export function parseCreditEntry(body) {
  const entry_type = String(body.entry_type || "")
  if (!LEDGER_ENTRY_TYPE.includes(entry_type)) {
    throw new AppError("entry_type must be debit or credit", 400)
  }
  const amount = Number(body.amount)
  if (Number.isNaN(amount) || amount <= 0) {
    throw new AppError("amount must be a number > 0", 400)
  }
  return {
    entry_type,
    amount,
    due_date: optionalString(body, "due_date"),
    note: optionalString(body, "note", { max: 2000 }),
  }
}
