import { Op } from "sequelize"
import { Product } from "../catalog/product.model.js"
import { Category } from "../catalog/category.model.js"
import { num } from "../pos/posResponses.js"
import { listOrderDiscounts } from "./orderDiscount.service.js"
import { bundlesForProducts } from "./bundleDiscount.service.js"
import { bulksForProducts } from "./bulkDiscount.service.js"
import { posBulks, posBundles, posOrderDiscount } from "./discountResponses.js"

/** Refs (short numbers or UUIDs) as rows of a model; a ref that matches nothing is skipped. */
async function rowsOf(model, numberColumn, storeId, refs, attributes, extraWhere = {}) {
  if (!refs.length) return []
  const numbers = refs.filter((value) => /^\d+$/.test(value)).map(Number)
  const uuids = refs.filter((value) => !/^\d+$/.test(value))
  const or = []
  if (numbers.length) or.push({ [numberColumn]: { [Op.in]: numbers } })
  if (uuids.length) or.push({ id: { [Op.in]: uuids } })
  return model.findAll({ where: { store_id: storeId, ...extraWhere, [Op.or]: or }, attributes })
}

const productDiscount = (row) => ({
  id: row.product_number,
  title: row.title,
  discount_name: row.discount_name || null,
  discount_type: row.discount_type,
  discount_value: num(row.discount_value),
  // What the discount is taken off: all | pack | loose | weight.
  applies_to: row.discount_applies_to || "all",
})

const categoryDiscount = (row) => ({
  id: row.category_number,
  name: row.name,
  discount_name: row.discount_name || null,
  discount_type: row.discount_type,
  discount_value: num(row.discount_value),
})

/**
 * Every discount that can touch a cart, in one reply. product_ids / category_ids are the products
 * and categories in the cart (short numbers or UUIDs); the categories of the cart's products are
 * added to the categories by themselves. A level with no discount comes back empty.
 *   categories / products: the category and product discounts of the cart,
 *   bulkDiscount: the live bulk discounts (buy more of one product) on the cart's products,
 *   bundle: the live bundles with one of the cart's products among their components,
 *   order: every active order discount (the cashier picks one).
 */
export async function cartDiscounts(scope, { productRefs, categoryRefs }) {
  const storeId = scope.store_id
  const products = await rowsOf(Product, "product_number", storeId, productRefs, [
    "id", "product_number", "title", "category_id", "parent_product_id", "has_product_discount",
    "discount_type", "discount_value", "discount_name", "discount_applies_to",
  ], { parent_product_id: null })
  const productIds = products.map((row) => row.id)
  // Bulk discounts and bundles may sit on one variant: look at the variants too.
  const variants = productIds.length
    ? await Product.findAll({ where: { parent_product_id: { [Op.in]: productIds }, deleted_at: null }, attributes: ["id"] })
    : []
  const rowIds = [...productIds, ...variants.map((row) => row.id)]

  const categoryIds = new Set()
  const askedCategories = await rowsOf(Category, "category_number", storeId, categoryRefs, ["id"])
  for (const row of askedCategories) categoryIds.add(row.id)
  for (const row of products) if (row.category_id) categoryIds.add(row.category_id)
  const categories = categoryIds.size
    ? await Category.findAll({
        where: { store_id: storeId, id: { [Op.in]: [...categoryIds] }, is_active: true },
        attributes: ["id", "category_number", "name", "discount_type", "discount_value", "discount_name"],
        order: [["category_number", "ASC"]],
      })
    : []

  const [orderDiscounts, bundles, bulks] = await Promise.all([
    listOrderDiscounts(storeId, { active: "1" }),
    bundlesForProducts(storeId, rowIds),
    bulksForProducts(storeId, rowIds),
  ])

  return {
    categories: categories.filter((row) => row.discount_type && row.discount_value != null).map(categoryDiscount),
    products: products
      .filter((row) => row.has_product_discount && row.discount_type && row.discount_value != null)
      .map(productDiscount),
    order: orderDiscounts.map(posOrderDiscount),
    bundle: await posBundles(bundles),
    bulkDiscount: await posBulks(bulks),
  }
}
