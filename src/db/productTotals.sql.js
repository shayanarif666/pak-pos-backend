// Expressions for the products.total_price_each_unit / total_pack_price generated columns.
// Discount first (only when has_product_discount), then tax on the discounted price; both
// capped so a price never goes below 0. For the pack, fixed amounts are per unit, so they are
// multiplied by pack_size.

function discounted(base, perUnitFactor) {
  const fixed = perUnitFactor ? `discount_value * ${perUnitFactor}` : "discount_value"
  return `(${base} - CASE
      WHEN has_product_discount = 1 AND discount_value IS NOT NULL AND discount_type = 'percentage'
        THEN LEAST(${base}, ${base} * discount_value / 100)
      WHEN has_product_discount = 1 AND discount_value IS NOT NULL AND discount_type = 'fixed'
        THEN LEAST(${base}, ${fixed})
      ELSE 0
    END)`
}

function withTax(net, perUnitFactor) {
  const fixed = perUnitFactor ? `tax_value * ${perUnitFactor}` : "tax_value"
  return `ROUND(${net} + CASE
      WHEN tax_value IS NOT NULL AND tax_type = 'percentage' THEN ${net} * tax_value / 100
      WHEN tax_value IS NOT NULL AND tax_type = 'fixed' THEN ${fixed}
      ELSE 0
    END, 2)`
}

export const TOTAL_PRICE_EACH_UNIT_SQL = withTax(discounted("selling_price"))

export const TOTAL_PACK_PRICE_SQL = `CASE
    WHEN is_pack_product = 1 AND pack_selling_price IS NOT NULL
      THEN ${withTax(discounted("pack_selling_price", "pack_size"), "pack_size")}
    ELSE NULL
  END`
