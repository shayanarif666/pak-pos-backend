import { AppError } from "../../shared/errors/AppError.js"
import { DISCOUNT_TYPE } from "../../db/enums.js"
import { staffRefFrom } from "../../shared/utils/staff.util.js"
import { activeFlag, assertDiscountFits, assertWindow, optionalDate, ref, requireText } from "./discountParse.js"
import { parseSaleUnit } from "./bulkDiscount.validation.js"

const REWARD_TYPES = ["free_item", "percentage", "fixed"]

/**
 * One product of a bundle: a number / UUID (one unit, or one pack of a pack product), or
 * { product_id, variant_id?, qty (default 1), sale_unit (unit | pack, default unit) }.
 */
function parseLine(entry, label) {
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const product = entry.product_id ?? entry.productId ?? entry.id
    const qty = entry.qty === undefined || entry.qty === null || entry.qty === "" ? 1 : Number(entry.qty)
    if (Number.isNaN(qty) || qty <= 0) throw new AppError(`${label}.qty must be a number greater than 0`, 400)
    return {
      product_ref: ref(product, `${label}.product_id`),
      variant_ref: entry.variant_id ?? entry.variantId ?? null,
      qty,
      sale_unit: parseSaleUnit(entry.sale_unit, `${label}.sale_unit`) ?? null,
      plain: false,
    }
  }
  return { product_ref: ref(entry, label), variant_ref: null, qty: 1, sale_unit: null, plain: true }
}

function parseLines(raw, label) {
  if (!Array.isArray(raw)) throw new AppError(`${label} must be an array`, 400)
  if (!raw.length) throw new AppError(`Send at least one product in ${label}`, 400)
  return raw.map((entry, index) => parseLine(entry, `${label}[${index}]`))
}

/** products (or components): what has to be bought together. undefined when not sent. */
function parseComponents(body) {
  const raw = body.products ?? body.components ?? body.product_ids
  return raw === undefined ? undefined : parseLines(raw, "products")
}

/**
 * The reward: reward { type: "free_item", items: [{ product_id, variant_id?, qty, sale_unit }] }, or
 * reward { type: "percentage" | "fixed", value }. Older clients send discount_type + discount_value:
 * that is a percentage / fixed reward. undefined when nothing about the reward was sent.
 */
function parseReward(body, { required }) {
  const raw = body.reward
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const type = String(raw.type ?? raw.reward_type ?? "")
    if (!REWARD_TYPES.includes(type)) throw new AppError("reward.type must be free_item, percentage or fixed", 400)
    if (type === "free_item") {
      if (!Array.isArray(raw.items) || !raw.items.length) throw new AppError("reward.items must list the free products", 400)
      return { reward_type: type, discount_type: null, discount_value: null, rewards: parseLines(raw.items, "reward.items") }
    }
    const sent = raw.value ?? raw.discount_value
    const value = sent === undefined || sent === null || sent === "" ? NaN : Number(sent)
    if (Number.isNaN(value) || value <= 0) throw new AppError("reward.value must be a number greater than 0", 400)
    assertDiscountFits(type, value)
    return { reward_type: type, discount_type: type, discount_value: value, rewards: [] }
  }
  if (body.discount_type !== undefined || body.discount_value !== undefined) {
    const type = String(body.discount_type ?? "")
    if (!DISCOUNT_TYPE.includes(type)) throw new AppError("discount_type must be percentage or fixed", 400)
    const value = body.discount_value === undefined || body.discount_value === null || body.discount_value === "" ? NaN : Number(body.discount_value)
    if (Number.isNaN(value) || value <= 0) throw new AppError("discount_value must be a number greater than 0", 400)
    assertDiscountFits(type, value)
    return { reward_type: type, discount_type: type, discount_value: value, rewards: [] }
  }
  if (required) throw new AppError("reward is required", 400)
  return undefined
}

export function parseCreateBundle(body) {
  const products = parseComponents(body)
  if (!products) throw new AppError("products is required", 400)
  const fields = {
    staff_ref: staffRefFrom(body),
    name: requireText(body, "name"),
    products,
    ...parseReward(body, { required: true }),
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
  const products = parseComponents(body)
  if (products) patch.products = products
  const reward = parseReward(body, { required: false })
  if (reward) Object.assign(patch, reward)
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
