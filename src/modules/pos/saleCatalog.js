import {
  applyDiscount,
  lineTaxAmount,
  money,
  packDiscountParts,
  unitDiscountParts,
} from "../commerce/pricing.service.js"

/*
 * What one sellable thing (a product, or a variant) is charged (used by the weight list). The figures are in rupees,
 * for ONE unit and for ONE pack: the product discount (on the pack / loose / weight it is set for),
 * then the category discount on the rest, and the taxes on what is left (a fixed tax is per unit,
 * so x pack size on a pack). The POS still works every order figure out itself.
 */

// The taxes of the Taxes page and of the product: only what the POS needs to name them on a line.
const TAX_ONLY_STORE = { charge_tax_on_sales: true, sales_tax_enabled: false }

export function categoryOf(view, refs) {
  const row = view.category
  if (!row) return null
  const ref = refs.category(view.category_id)
  return {
    id: ref?.id ?? null,
    name: row.name,
    tax: row.tax_type && row.tax_value != null ? { name: row.tax_name || null, type: row.tax_type, value: Number(row.tax_value) } : null,
    discount: row.discount_type && row.discount_value != null ? { name: row.discount_name || null, type: row.discount_type, value: Number(row.discount_value) } : null,
  }
}

/** What one sellable thing (a product without variants, or one variant) is charged, per unit and per pack. */
export function figures(row, { discountRule, category, isWeightBased, bundles = [] }) {
  const pack = Boolean(row.is_pack_product) && Number(row.pack_size) >= 2
  const sellLoose = pack ? Boolean(row.sell_loose) : true
  const catalogCategory = category
    ? { discount_type: category.discount?.type, discount_value: category.discount?.value, tax_type: category.tax?.type, tax_value: category.tax?.value }
    : null
  const priced = {
    selling_price: row.selling_price,
    taxes: row.taxes,
    store_taxes: row.store_taxes,
    ...discountRule,
  }
  const out = { pack_discount_value: null, unit_discount_value: null, pack_tax_value: null, unit_tax_value: null }
  if (sellLoose && row.selling_price != null) {
    const parts = unitDiscountParts(priced, catalogCategory, isWeightBased ? "weight" : "loose")
    const discount = money(parts.own + parts.fromCategory)
    out.unit_discount_value = discount
    out.unit_tax_value = lineTaxAmount(TAX_ONLY_STORE, priced, catalogCategory, money(Number(row.selling_price) - discount), 1)
  }
  if (pack && row.pack_selling_price != null) {
    const size = Number(row.pack_size)
    const parts = packDiscountParts(priced, catalogCategory, Number(row.pack_selling_price), size)
    let discount = money(parts.own + parts.fromCategory)
    // A bundle discount is on the whole pack, taken off what is left after the product and category discounts.
    for (const bundle of bundles) {
      discount = money(discount + applyDiscount(money(Number(row.pack_selling_price) - discount), bundle.type, bundle.value))
    }
    out.pack_discount_value = discount
    out.pack_tax_value = lineTaxAmount(TAX_ONLY_STORE, priced, catalogCategory, money(Number(row.pack_selling_price) - discount), size)
  }
  return out
}
