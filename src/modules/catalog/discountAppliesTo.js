/**
 * products.discount_applies_to: what the product's own discount is taken off. A product that is
 * a pack, sold loose and by weight can have it on the pack, the loose item, the weight, or all.
 * kind = how the line is sold: "pack" | "loose" | "weight" (undefined = no check).
 */
export function discountAppliesTo(appliesTo, kind) {
  if (!kind) return true
  const value = appliesTo || "all"
  return value === "all" || value === kind
}

/** The way a sale line is sold: a whole pack, by weight, or loose items. */
export function saleKind(product, byPack) {
  if (byPack) return "pack"
  return product?.is_weight_based ? "weight" : "loose"
}
