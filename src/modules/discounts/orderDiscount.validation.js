import { activeFlag, boolFlag, discountPair, requireText } from "./discountParse.js"
import { AppError } from "../../shared/errors/AppError.js"
import { staffRefFrom } from "../../shared/utils/staff.util.js"

/** name, discount_type, discount_value, apply_to_all_orders (default true), status. */
export function parseCreateOrderDiscount(body) {
  return {
    staff_ref: staffRefFrom(body),
    name: requireText(body, "name"),
    ...discountPair(body, { required: true }),
    apply_to_all_orders: boolFlag(body, "apply_to_all_orders") ?? true,
    is_active: activeFlag(body) ?? true,
  }
}

export function parsePatchOrderDiscount(body) {
  const patch = {}
  if (body.name !== undefined) patch.name = requireText(body, "name")
  Object.assign(patch, discountPair(body, { required: false }))
  const all = boolFlag(body, "apply_to_all_orders")
  if (all !== undefined) patch.apply_to_all_orders = all
  const active = activeFlag(body)
  if (active !== undefined) patch.is_active = active
  if (!Object.keys(patch).length) throw new AppError("No fields to update", 400)
  return patch
}
