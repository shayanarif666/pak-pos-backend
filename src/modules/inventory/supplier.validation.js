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

export function parseCreateSupplier(body) {
  return {
    name: requireString(body, "name"),
    phone: optionalString(body, "phone"),
    email: optionalString(body, "email"),
    address: optionalString(body, "address"),
    payment_terms: optionalString(body, "payment_terms"),
  }
}

export function parsePatchSupplier(body) {
  const patch = {}
  if (body.name !== undefined) patch.name = requireString(body, "name")
  if (body.phone !== undefined) patch.phone = optionalString(body, "phone")
  if (body.email !== undefined) patch.email = optionalString(body, "email")
  if (body.address !== undefined) patch.address = optionalString(body, "address")
  if (body.payment_terms !== undefined) {
    patch.payment_terms = optionalString(body, "payment_terms")
  }
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active)
  if (!Object.keys(patch).length) throw new AppError("No fields to update", 400)
  return patch
}

export function parseLedgerEntry(body) {
  const entry_type = String(body.entry_type || "")
  if (!LEDGER_ENTRY_TYPE.includes(entry_type)) {
    throw new AppError("entry_type must be debit or credit", 400)
  }
  const amount = Number(body.amount)
  if (Number.isNaN(amount) || amount <= 0) {
    throw new AppError("amount must be a number > 0", 400)
  }

  const product_id = optionalUuid(body, "product_id")
  const qty =
    body.qty === undefined || body.qty === null || body.qty === ""
      ? null
      : Number(body.qty)
  if (qty !== null && (Number.isNaN(qty) || qty <= 0)) {
    throw new AppError("qty must be a number > 0", 400)
  }
  if ((product_id && !qty) || (qty && !product_id)) {
    throw new AppError("product_id and qty are required together", 400)
  }

  return {
    entry_type,
    amount,
    location_id: optionalUuid(body, "location_id"),
    product_id,
    qty,
    due_date: optionalString(body, "due_date"),
    note: optionalString(body, "note"),
  }
}
