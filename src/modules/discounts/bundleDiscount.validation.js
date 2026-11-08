import { AppError } from "../../shared/errors/AppError.js"
import { staffRefFrom } from "../../shared/utils/staff.util.js"
import { activeFlag, assertWindow, discountPair, optionalDate, ref, requireText } from "./discountParse.js"

/** products: [1, 2] (product numbers or UUIDs) or [{ product_id: 1 }]: the pack products the bundle covers. */
function parseProducts(body) {
  const raw = body.products ?? body.product_ids
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) throw new AppError("products must be an array", 400)
  const refs = [...new Set(raw.map((entry) => ref(entry && typeof entry === "object" ? entry.product_id ?? entry.id : entry, "products[]")))]
  if (!refs.length) throw new AppError("Send at least one product", 400)
  return refs
}

export function parseCreateBundle(body) {
  const products = parseProducts(body)
  if (!products) throw new AppError("products is required", 400)
  const fields = {
    staff_ref: staffRefFrom(body),
    name: requireText(body, "name"),
    products,
    ...discountPair(body, { required: true }),
    start_at: optionalDate(body, "start_at") ?? null,
    end_at: optionalDate(body, "end_at") ?? null,
    is_active: activeFlag(body) ?? true,
  }
  assertWindow(fields.start_at, fields.end_at)
  return fields
}

export function parsePatchBundle(body) {
  const patch = {}
  if (body.name !== undefined) patch.name = requireText(body, "name")
  const products = parseProducts(body)
  if (products) patch.products = products
  Object.assign(patch, discountPair(body, { required: false }))
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
