import { AppError } from "../../shared/errors/AppError.js"
import { DISCOUNT_TYPE } from "../../db/enums.js"
import { staffRefFrom } from "../../shared/utils/staff.util.js"
import { activeFlag, assertDiscountFits, assertWindow, optionalDate, requireText } from "./discountParse.js"

export const SALE_UNITS = ["unit", "pack"]

/** unit | pack (what min_qty counts); undefined when not sent. */
export function parseSaleUnit(value, label = "sale_unit") {
  if (value === undefined || value === null || value === "") return undefined
  const text = String(value)
  if (!SALE_UNITS.includes(text)) throw new AppError(`${label} must be unit or pack`, 400)
  return text
}

/**
 * tiers: [{ min_qty, discount_type, discount_value }] (type / value also work): from min_qty on, every
 * unit is cut by the value — a percentage of its price, or Rs off each unit. Sorted by min_qty.
 */
function parseTiers(body, { required }) {
  const raw = body.tiers
  if (raw === undefined) {
    if (required) throw new AppError("tiers is required", 400)
    return undefined
  }
  if (!Array.isArray(raw) || !raw.length) throw new AppError("tiers must be a non-empty array of { min_qty, discount_type, discount_value }", 400)
  const seen = new Set()
  const tiers = raw.map((row, index) => {
    const at = `tiers[${index}]`
    if (!row || typeof row !== "object") throw new AppError(`${at} is invalid`, 400)
    const min_qty = Number(row.min_qty)
    if (row.min_qty === undefined || row.min_qty === null || row.min_qty === "" || Number.isNaN(min_qty) || min_qty <= 0) {
      throw new AppError(`${at}.min_qty must be a number greater than 0`, 400)
    }
    const type = String(row.discount_type ?? row.type ?? "")
    if (!DISCOUNT_TYPE.includes(type)) throw new AppError(`${at}.discount_type must be percentage or fixed`, 400)
    const rawValue = row.discount_value ?? row.value
    const value = rawValue === undefined || rawValue === null || rawValue === "" ? NaN : Number(rawValue)
    if (Number.isNaN(value) || value <= 0) throw new AppError(`${at}.discount_value must be a number greater than 0`, 400)
    assertDiscountFits(type, value)
    if (seen.has(min_qty)) throw new AppError(`${at}.min_qty ${min_qty} is sent twice`, 400)
    seen.add(min_qty)
    return { min_qty, discount_type: type, discount_value: value }
  })
  return tiers.sort((a, b) => a.min_qty - b.min_qty)
}

/** name, product_id (+ variant_id), sale_unit (default unit), tiers, start_at, end_at, status. */
export function parseCreateBulk(body) {
  const product = body.product_id ?? body.productId
  if (product === undefined || product === null || product === "") throw new AppError("product_id is required", 400)
  const fields = {
    staff_ref: staffRefFrom(body),
    name: requireText(body, "name"),
    product_ref: String(product).trim(),
    variant_ref: body.variant_id ?? body.variantId ?? null,
    sale_unit: parseSaleUnit(body.sale_unit) ?? "unit",
    tiers: parseTiers(body, { required: true }),
    start_at: optionalDate(body, "start_at") ?? null,
    end_at: optionalDate(body, "end_at") ?? null,
    is_active: activeFlag(body) ?? true,
  }
  assertWindow(fields.start_at, fields.end_at)
  return fields
}

/** The product (and variant) of a bulk discount stay: send tiers, name, sale_unit, dates or status. */
export function parsePatchBulk(body) {
  const patch = {}
  if (body.name !== undefined) patch.name = requireText(body, "name")
  const sale = parseSaleUnit(body.sale_unit)
  if (sale !== undefined) patch.sale_unit = sale
  const tiers = parseTiers(body, { required: false })
  if (tiers) patch.tiers = tiers
  const start = optionalDate(body, "start_at")
  const end = optionalDate(body, "end_at")
  if (start !== undefined) patch.start_at = start
  if (end !== undefined) patch.end_at = end
  const active = activeFlag(body)
  if (active !== undefined) patch.is_active = active
  if (!Object.keys(patch).length) throw new AppError("No fields to update", 400)
  assertWindow(patch.start_at, patch.end_at)
  return patch
}
