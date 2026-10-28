import { AppError } from "../errors/AppError.js"
import { NotFoundError } from "../errors/NotFoundError.js"
import { extractBulkItems, runBulk } from "./bulk.util.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * A row's UUID from its short number in the store (1, 2, 3... — what the POS shows); the UUID
 * itself also works (the dashboard). column is the model's number column, e.g. product_number.
 */
export async function uuidOfNumber(model, column, storeId, ref, label) {
  if (ref === undefined || ref === null || String(ref).trim() === "") {
    throw new AppError(`${label} id is required`, 400)
  }
  const value = String(ref).trim()
  if (UUID_RE.test(value)) return value
  if (!/^[1-9]\d*$/.test(value)) throw new AppError(`${label} id must be a number (1, 2, 3...)`, 400)
  const row = await model.findOne({
    where: { store_id: storeId, [column]: Number(value) },
    attributes: ["id"],
  })
  if (!row) throw new NotFoundError(`${label} ${value} not found`)
  return row.id
}

/** Same as uuidOfNumber, but null / empty stays null (an optional reference). */
export async function optionalUuidOfNumber(model, column, storeId, ref, label) {
  if (ref === undefined) return undefined
  if (ref === null || String(ref).trim() === "") return null
  return uuidOfNumber(model, column, storeId, ref, label)
}

/**
 * Bulk update (POS offline sync): items[] = [{ id, ...fields }], id = the row's short number.
 * Each row is updated on its own — one that fails is listed in failed[] and the rest still save.
 * handler(uuid, fields, item, index) returns the updated row.
 */
export async function runBulkUpdate(body, { model, column, label, storeId, handler }) {
  return runBulk(extractBulkItems(body), async (item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new AppError("Each item must be an object", 400)
    }
    const { id, ...fields } = item
    const uuid = await uuidOfNumber(model, column, storeId, id, label)
    return handler(uuid, fields, item, index)
  })
}

/**
 * Reply of a bulk update: data = the updated rows. Rows that failed are listed in failed[]
 * ({ index, message, status }); when every row failed the reply is that first error.
 */
export function bulkUpdateResponse(res, result, message, rows) {
  if (result.created_count === 0 && result.failed_count > 0) {
    const first = result.failed[0]
    return res.status(first.status || 400).json({
      success: false,
      message: first.message,
      data: [],
      failed: result.failed,
    })
  }
  return res.status(200).json({
    success: true,
    message,
    data: rows,
    ...(result.failed_count ? { failed: result.failed } : {}),
  })
}

/** Only these keys of fields; at least one must be there. */
export function pickFields(fields, keys, label) {
  const out = {}
  for (const key of keys) if (fields[key] !== undefined) out[key] = fields[key]
  if (!Object.keys(out).length) throw new AppError(`${label}: send at least one of ${keys.join(", ")}`, 400)
  return out
}

/** A required true / false. */
export function requireBoolean(fields, key) {
  const value = fields[key]
  if (value === true || value === false) return value
  if (value === "true" || value === 1 || value === "1") return true
  if (value === "false" || value === 0 || value === "0") return false
  throw new AppError(`${key} must be true or false`, 400)
}
