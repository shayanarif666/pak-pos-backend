import { Op } from "sequelize"
import { Order } from "./order.model.js"
import { Product } from "../catalog/product.model.js"
import { Customer } from "../customers/customer.model.js"
import { RegisterSession } from "../pos/registerSession.model.js"
import { Offer } from "../offers/offer.model.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { AppError } from "../../shared/errors/AppError.js"

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
 * product_id + variant_id (the variant's number inside the product, or its UUID) → the variant's
 * own product UUID, which is what is sold and stocked.
 */
async function variantProductId(storeId, productRef, variantRef) {
  if (!productRef) throw new AppError("variant_id needs the product_id of its product", 400)
  const parent = await Product.findOne({
    where: isNumber(productRef) ? { store_id: storeId, product_number: Number(productRef) } : { store_id: storeId, id: productRef },
    attributes: ["id", "title", "has_variants"],
  })
  if (!parent) throw new NotFoundError(`Product ${productRef} not found`)
  if (!parent.has_variants) throw new AppError(`${parent.title} has no variants: leave variant_id out`, 400)
  const variant = await Product.findOne({
    where: isNumber(variantRef)
      ? { store_id: storeId, parent_product_id: parent.id, variant_number: Number(variantRef) }
      : { store_id: storeId, parent_product_id: parent.id, id: variantRef },
    attributes: ["id"],
  })
  if (!variant) throw new NotFoundError(`Variant ${variantRef} of ${parent.title} not found`)
  return variant.id
}

/**
 * The POS sends short numbers (productId, batchId, customer_id); placeOrder works with UUIDs,
 * so the numbers are swapped for the rows' UUIDs here. A line with variant_id sells that variant.
 */
export async function resolveOrderRefs(storeId, input) {
  input = {
    ...input,
    items: await Promise.all(
      (input.items || []).map(async ({ variant_id, ...item }) =>
        variant_id ? { ...item, product_id: await variantProductId(storeId, item.product_id, variant_id) } : item
      )
    ),
  }
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
  // A POS-priced line may name the discounts (offers) that priced it: their numbers or UUIDs.
  const offerNumbers = [
    ...new Set(
      (input.items || [])
        .flatMap((item) => item.priced?.discount?.offer_refs || [])
        .filter((ref) => ref && isNumber(ref))
        .map(Number)
    ),
  ]
  const offers = offerNumbers.length
    ? await Offer.findAll({
        where: { store_id: storeId, offer_number: { [Op.in]: offerNumbers } },
        attributes: ["id", "offer_number"],
        // A sale made offline before the discount was deleted still records it.
        paranoid: false,
      })
    : []
  const offerByNumber = new Map(offers.map((row) => [String(row.offer_number), row.id]))
  const items = (input.items || []).map((item) => {
    let next = item
    if (item.product_id && isNumber(item.product_id)) {
      const id = byNumber.get(String(Number(item.product_id)))
      if (!id) throw new NotFoundError(`Product ${item.product_id} not found`)
      next = { ...next, product_id: id }
    }
    const offerRefs = item.priced?.discount?.offer_refs || []
    if (offerRefs.length) {
      const offer_ids = offerRefs.map((ref) => {
        const offerId = isNumber(ref) ? offerByNumber.get(String(Number(ref))) : ref
        if (!offerId) throw new NotFoundError(`Discount ${ref} not found`)
        return offerId
      })
      next = { ...next, priced: { ...next.priced, discount: { ...next.priced.discount, offer_ids } } }
    }
    return next
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
