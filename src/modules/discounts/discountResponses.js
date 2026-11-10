import { Refs, num } from "../pos/posResponses.js"
import { pageOf, sendPage } from "../pos/posHistory.service.js"

/** Order-level discount as the POS reads it: id = its short number. */
export function posOrderDiscount(view) {
  return {
    id: view.discount_number,
    name: view.name,
    discount_type: view.discount_type,
    discount_value: num(view.discount_value),
    is_active: view.is_active,
    status: view.is_active ? "active" : "inactive",
  }
}

/** Bulk discounts as the POS reads them: id = short number, product (with its variant), the tiers. */
export async function posBulks(views) {
  const refs = await new Refs().loadAll({
    product: views.map((view) => view.product_id),
    user: views.map((view) => view.created_by),
  })
  return views.map((view) => ({
    id: view.bulk_number,
    name: view.name,
    product: refs.product(view.product_id),
    // What min_qty counts: unit | pack. From min_qty on, every unit is cut: a percentage of its price, or Rs off each unit.
    sale_unit: view.sale_unit,
    tiers: view.tiers,
    start_at: view.start_at,
    end_at: view.end_at,
    is_active: view.is_active,
    status: view.is_active ? "active" : "inactive",
    staff: refs.staff(view.created_by),
  }))
}

/**
 * Bundle discounts as the POS reads them: id = short number; components = what is bought together
 * (product with its variant, qty, unit); reward = free items, or a percentage / fixed amount off.
 */
export async function posBundles(views) {
  const lineIds = (view) => [...view.components, ...view.rewards].map((line) => line.product_id)
  const refs = await new Refs().loadAll({
    product: views.flatMap(lineIds),
    user: views.map((view) => view.created_by),
  })
  const line = (row) => ({ product: refs.product(row.product_id), qty: row.qty, sale_unit: row.sale_unit })
  return views.map((view) => ({
    id: view.bundle_number,
    name: view.name,
    components: view.components.map(line),
    reward:
      view.reward_type === "free_item"
        ? { type: "free_item", items: view.rewards.map(line) }
        : { type: view.reward_type, value: num(view.discount_value) },
    start_at: view.start_at,
    end_at: view.end_at,
    is_active: view.is_active,
    status: view.is_active ? "active" : "inactive",
    staff: refs.staff(view.created_by),
  }))
}

/** A page of a list already in memory, in the POS shape ({ data, pagination }). */
export function sendList(req, res, list, map) {
  const { page, limit, offset } = pageOf(req.query)
  const rows = list.slice(offset, offset + limit).map(map)
  return sendPage(res, { rows, pagination: { page, limit, total: list.length, total_pages: Math.max(1, Math.ceil(list.length / limit)) } })
}
