import { Op } from "sequelize"
import { Order } from "./order.model.js"
import { Product } from "../catalog/product.model.js"
import { Customer } from "../customers/customer.model.js"
import { RegisterSession } from "../pos/registerSession.model.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

const isNumber = (ref) => /^\d+$/.test(String(ref))

/** An order reference (order number or UUID) as the order's UUID. */
export async function orderIdFromRef(storeId, ref) {
  if (!isNumber(ref)) return ref
  const order = await Order.findOne({
    where: { store_id: storeId, order_number: Number(ref) },
    attributes: ["id"],
  })
  if (!order) throw new NotFoundError("Order not found")
  return order.id
}

async function idFromNumber(model, column, storeId, ref, label) {
  if (!ref || !isNumber(ref)) return ref
  const row = await model.findOne({
    where: { store_id: storeId, [column]: Number(ref) },
    attributes: ["id"],
  })
  if (!row) throw new NotFoundError(`${label} not found`)
  return row.id
}

/**
 * The POS sends short numbers (productId, batchId, customer_id); placeOrder works with UUIDs,
 * so the numbers are swapped for the rows' UUIDs here.
 */
export async function resolveOrderRefs(storeId, input) {
  const numbers = [
    ...new Set(
      (input.items || [])
        .map((item) => item.product_id)
        .filter((ref) => ref && isNumber(ref))
        .map(Number)
    ),
  ]
  const products = numbers.length
    ? await Product.findAll({
        where: { store_id: storeId, product_number: { [Op.in]: numbers } },
        attributes: ["id", "product_number"],
      })
    : []
  const byNumber = new Map(products.map((row) => [String(row.product_number), row.id]))
  const items = (input.items || []).map((item) => {
    if (!item.product_id || !isNumber(item.product_id)) return item
    const id = byNumber.get(String(Number(item.product_id)))
    if (!id) throw new NotFoundError(`Product ${item.product_id} not found`)
    return { ...item, product_id: id }
  })
  return {
    ...input,
    items,
    register_session_id: await idFromNumber(
      RegisterSession,
      "session_number",
      storeId,
      input.register_session_id,
      "Batch"
    ),
    customer_id: await idFromNumber(Customer, "customer_number", storeId, input.customer_id, "Customer"),
  }
}
