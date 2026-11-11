import { Op } from "sequelize"
import { Product } from "./product.model.js"

/**
 * The product discount of one row as { name, type, value, applies_to } or null. A variant view carries it
 * as discount (its own), a product row as the discount columns.
 */
export function ownDiscountOf(row) {
  if (!row) return null
  if (row.discount !== undefined) return row.discount || null
  return row.has_product_discount && row.discount_type && row.discount_value != null
    ? { name: row.discount_name || null, type: row.discount_type, value: Number(row.discount_value), applies_to: row.discount_applies_to || "all" }
    : null
}

/**
 * The discount a variant is sold with: its own; else its product's (a variant takes it unless
 * uses_product_discount is false); else none. source says where it came from: "variant" | "product".
 */
export function effectiveDiscount(variant, parent) {
  const own = ownDiscountOf(variant)
  if (own) return { ...own, source: "variant" }
  if (variant?.uses_product_discount === false) return null
  const inherited = ownDiscountOf(parent)
  return inherited ? { ...inherited, source: "product" } : null
}

/**
 * Product rows about to be priced: a variant row gets the discount it is sold with in its discount columns
 * (in memory only, nothing is saved), so pricing reads one place. Other rows are left as they are.
 */
export async function withEffectiveDiscounts(rows, { transaction } = {}) {
  const variants = rows.filter((row) => row.parent_product_id)
  if (!variants.length) return rows
  const parentIds = [...new Set(variants.map((row) => row.parent_product_id))]
  const parents = new Map(
    (await Product.findAll({
      where: { id: { [Op.in]: parentIds } },
      attributes: ["id", "has_product_discount", "discount_type", "discount_value", "discount_name", "discount_applies_to"],
      transaction,
    })).map((row) => [row.id, row])
  )
  for (const row of variants) {
    const found = effectiveDiscount(row, parents.get(row.parent_product_id))
    row.setDataValue("has_product_discount", Boolean(found))
    row.setDataValue("discount_type", found?.type ?? null)
    row.setDataValue("discount_value", found?.value ?? null)
    row.setDataValue("discount_name", found?.name ?? null)
    row.setDataValue("discount_applies_to", found?.applies_to ?? "all")
  }
  return rows
}
