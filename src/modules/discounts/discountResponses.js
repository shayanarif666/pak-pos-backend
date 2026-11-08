import { Refs, num } from "../pos/posResponses.js"
import { pageOf, sendPage } from "../pos/posHistory.service.js"

/** Order-level discount as the POS reads it: id = its short number. */
export function posOrderDiscount(view) {
  return {
    id: view.discount_number,
    name: view.name,
    discount_type: view.discount_type,
    discount_value: num(view.discount_value),
    apply_to_all_orders: Boolean(view.apply_to_all_orders),
    is_active: view.is_active,
    status: view.is_active ? "active" : "inactive",
  }
}

/** Bundle discount as the POS reads it: id = its short number, products = the cartons it covers. */
export async function posBundles(views) {
  const refs = await new Refs().loadAll({
    product: views.flatMap((view) => view.product_ids || []),
    user: views.map((view) => view.created_by),
  })
  return views.map((view) => ({
    id: view.bundle_number,
    name: view.name,
    discount_type: view.discount_type,
    discount_value: num(view.discount_value),
    products: (view.product_ids || []).map((id) => {
      const product = refs.get("product", id)
      return {
        ...refs.product(id),
        pack_size: product?.pack_size ?? null,
        pack_price: num(product?.pack_selling_price),
      }
    }),
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
