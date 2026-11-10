import { Product } from "../catalog/product.model.js"
import { AppError } from "../../shared/errors/AppError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

/**
 * A product (and one of its variants) a bulk or bundle discount points at, from the short numbers the
 * POS uses: product_id (number or UUID) and variant_id (the variant's number inside the product, or UUID).
 * Returns { id, title, is_pack_product, parent_id, has_variants }: id is the row the discount is saved on
 * (the variant's own product row for a variant, else the product's).
 *   needVariant: a product with variants must name the variant (a free item / a component is one thing).
 *   sale_unit pack needs a pack product / pack variant.
 */
export async function resolveSellable(storeId, productRef, variantRef, { label, needVariant = false, saleUnit = "unit" } = {}) {
  const text = String(productRef ?? "").trim()
  if (!text) throw new AppError(`${label}.product_id is required`, 400)
  const parent = await Product.findOne({
    where: /^\d+$/.test(text)
      ? { store_id: storeId, product_number: Number(text), parent_product_id: null, deleted_at: null }
      : { store_id: storeId, id: text, parent_product_id: null, deleted_at: null },
    attributes: ["id", "title", "has_variants", "is_pack_product"],
  })
  if (!parent) throw new NotFoundError(`${label}: product ${text} not found`)

  const variantText = variantRef == null || variantRef === "" ? "" : String(variantRef).trim()
  let row = parent
  if (variantText) {
    if (!parent.has_variants) throw new AppError(`${label}: ${parent.title} has no variants: leave variant_id out`, 400)
    const variant = await Product.findOne({
      where: /^\d+$/.test(variantText)
        ? { store_id: storeId, parent_product_id: parent.id, variant_number: Number(variantText), deleted_at: null }
        : { store_id: storeId, parent_product_id: parent.id, id: variantText, deleted_at: null },
      attributes: ["id", "title", "is_pack_product"],
    })
    if (!variant) throw new NotFoundError(`${label}: variant ${variantText} of ${parent.title} not found`)
    row = variant
  } else if (parent.has_variants && needVariant) {
    throw new AppError(`${label}: ${parent.title} has variants: send variant_id`, 400)
  }
  if (saleUnit === "pack" && !row.is_pack_product) {
    throw new AppError(`${label}: ${row.title} is not a pack product: sale_unit must be unit`, 400)
  }
  return { id: row.id, title: row.title, is_pack_product: Boolean(row.is_pack_product), parent_id: parent.id, has_variants: Boolean(parent.has_variants) }
}

/** The product ids a line of this product matches: its own row and, for a variant, the product it belongs to. */
export function idsOfProduct(row) {
  return row.parent_product_id ? [row.id, row.parent_product_id] : [row.id]
}
