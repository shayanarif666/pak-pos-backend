import { AppError } from "../../shared/errors/AppError.js"
import { BILLING_STATUS } from "../../db/enums.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function optionalString(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  return String(body[key]).trim()
}

function optionalDate(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return undefined
  const d = new Date(body[key])
  if (Number.isNaN(d.getTime())) throw new AppError(`${key} must be a date`, 400)
  return d
}

export function parseCreateBilling(body) {
  const store_id = String(body.store_id || "").trim()
  if (!UUID_RE.test(store_id)) throw new AppError("store_id must be a UUID", 400)

  const status = body.status ? String(body.status) : "pending"
  if (!BILLING_STATUS.includes(status)) {
    throw new AppError("status must be pending, paid, failed, or refunded", 400)
  }

  let amount
  if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
    amount = Number(body.amount)
    if (Number.isNaN(amount) || amount < 0) {
      throw new AppError("amount must be a number >= 0", 400)
    }
  }

  const period_start = optionalDate(body, "period_start")
  const period_end = optionalDate(body, "period_end")
  if (!period_start || !period_end) {
    throw new AppError("period_start and period_end are required", 400)
  }

  return {
    store_id,
    plan_id: body.plan_id && UUID_RE.test(body.plan_id) ? body.plan_id : undefined,
    amount,
    status,
    period_start,
    period_end,
    method_note: optionalString(body, "method_note"),
    note: optionalString(body, "note"),
  }
}

export function parsePatchBilling(body) {
  const patch = {}
  if (body.status !== undefined) {
    if (!BILLING_STATUS.includes(body.status)) {
      throw new AppError("status must be pending, paid, failed, or refunded", 400)
    }
    patch.status = body.status
  }
  if (body.amount !== undefined) {
    const amount = Number(body.amount)
    if (Number.isNaN(amount) || amount < 0) {
      throw new AppError("amount must be a number >= 0", 400)
    }
    patch.amount = amount
  }
  if (body.method_note !== undefined) patch.method_note = optionalString(body, "method_note")
  if (body.note !== undefined) patch.note = optionalString(body, "note")
  if (body.paid_at !== undefined) patch.paid_at = optionalDate(body, "paid_at")
  return patch
}
