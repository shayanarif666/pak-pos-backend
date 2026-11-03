import { UniqueConstraintError } from "sequelize"
import { PaymentSurcharge, SURCHARGE_METHODS } from "./paymentSurcharge.model.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { nextSurchargeNumber } from "../../shared/utils/counter.util.js"

/** As the API returns it: id = surcharge_number (the UUID is not returned; it is still accepted as an id). */
export function publicSurcharge(row) {
  const json = row.toJSON ? row.toJSON() : row
  return {
    id: json.surcharge_number,
    method: json.method,
    type: json.type,
    charges: Number(json.charges),
    is_active: Boolean(json.is_active),
    created_at: json.created_at,
    updated_at: json.updated_at,
  }
}

function parseActive(body) {
  const value = body.is_active ?? body.isActive
  if (value === undefined || value === null) return undefined
  if (value === "false" || value === 0 || value === "0") return false
  return Boolean(value)
}

function parseCharges(body, type) {
  const raw = body.charges ?? body.value ?? body.amount
  const value = Number(raw)
  if (raw === undefined || raw === null || raw === "" || Number.isNaN(value) || value < 0) {
    throw new AppError("charges must be a number >= 0", 400)
  }
  if (type === "percentage" && value > 100) throw new AppError("a percentage charge cannot exceed 100", 400)
  return value
}

function parseType(body, fallback) {
  const raw = body.type
  if (raw === undefined || raw === null || raw === "") return fallback
  if (!["percentage", "fixed"].includes(String(raw))) throw new AppError("type must be percentage or fixed", 400)
  return String(raw)
}

export function parseCreateSurcharge(body) {
  const method = String(body.method ?? "")
  if (!SURCHARGE_METHODS.includes(method)) throw new AppError(`method must be one of ${SURCHARGE_METHODS.join(", ")}`, 400)
  const type = parseType(body, "percentage")
  return { method, type, charges: parseCharges(body, type), is_active: parseActive(body) ?? true }
}

export function parsePatchSurcharge(body) {
  const fields = {}
  if (body.method !== undefined) {
    if (!SURCHARGE_METHODS.includes(String(body.method))) throw new AppError(`method must be one of ${SURCHARGE_METHODS.join(", ")}`, 400)
    fields.method = String(body.method)
  }
  const type = parseType(body, undefined)
  if (type) fields.type = type
  if (body.charges !== undefined || body.value !== undefined || body.amount !== undefined) {
    fields.charges = parseCharges(body, type || "fixed")
  }
  const active = parseActive(body)
  if (active !== undefined) fields.is_active = active
  if (!Object.keys(fields).length) throw new AppError("No fields to update", 400)
  return fields
}

async function getSurcharge(storeId, ref) {
  const value = String(ref ?? "").trim()
  const where = /^\d+$/.test(value) ? { store_id: storeId, surcharge_number: Number(value) } : { store_id: storeId, id: value }
  const row = await PaymentSurcharge.findOne({ where })
  if (!row) throw new NotFoundError("Surcharge not found")
  return row
}

const taken = (method) => new ConflictError(`${method} already has a surcharge: update it instead`)

export async function listSurcharges(storeId) {
  const rows = await PaymentSurcharge.findAll({ where: { store_id: storeId }, order: [["surcharge_number", "ASC"]] })
  return rows.map(publicSurcharge)
}

export async function getSurchargeView(storeId, ref) {
  return publicSurcharge(await getSurcharge(storeId, ref))
}

export async function createSurcharge(store, fields, actor) {
  try {
    const row = await PaymentSurcharge.create({
      store_id: store.id,
      store_id_int: store.store_id_int,
      surcharge_number: await nextSurchargeNumber(store.id),
      ...fields,
      created_by: actor?.id || null,
    })
    return publicSurcharge(row)
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw taken(fields.method)
    throw err
  }
}

export async function updateSurcharge(storeId, ref, fields) {
  const row = await getSurcharge(storeId, ref)
  if ((fields.type ?? row.type) === "percentage" && Number(fields.charges ?? row.charges) > 100) {
    throw new AppError("a percentage charge cannot exceed 100", 400)
  }
  try {
    await row.update(fields)
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw taken(fields.method)
    throw err
  }
  return publicSurcharge(row)
}

export async function deleteSurcharge(storeId, ref) {
  const row = await getSurcharge(storeId, ref)
  await row.destroy()
  return { id: row.surcharge_number, deleted: true }
}

/**
 * The active surcharges as the payment-tax engine reads its rates:
 * [{ payment_method, gst_percent (percentage), fixed_amount (fixed, per payment) }].
 */
export async function surchargeRates(storeId) {
  const rows = await PaymentSurcharge.findAll({ where: { store_id: storeId, is_active: true } })
  return rows.map((row) => ({
    payment_method: row.method,
    gst_percent: row.type === "percentage" ? Number(row.charges) : 0,
    fixed_amount: row.type === "fixed" ? Number(row.charges) : 0,
  }))
}
