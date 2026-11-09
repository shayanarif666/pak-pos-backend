import { Refs } from "./posResponses.js"
import {
  lineTaxAmount,
  money,
  packDiscountParts,
  productTaxList,
  unitDiscountParts,
} from "../commerce/pricing.service.js"

/*
 * GET /products?view=sale: the register's catalog. A product with variants is not sold itself, so its
 * price, cost, pack, discount, taxes and the four *_value figures are null and each variant carries
 * its own; a product without variants carries them at the top. The *_value figures are in rupees,
 * for ONE unit and for ONE pack: the product discount (on the pack / loose / weight it is set for),
 * then the category discount on the rest, and the taxes on what is left (a fixed tax is per unit,
 * so x pack size on a pack). The POS still works every order figure out itself.
 */

// The taxes of the Taxes page and of the product: only what the POS needs to name them on a line.
const TAX_ONLY_STORE = { charge_tax_on_sales: true, sales_tax_enabled: false }

function categoryOf(view, refs) {
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

/** The taxes a line is charged, named: the product's (and, on a variant, its own) then the Taxes page ones. */
function taxList(row) {
  return [
    ...productTaxList(row).map((tax) => ({ level: "product", name: tax.name, type: tax.type, value: tax.value })),
    ...productTaxList({ taxes: row.store_taxes || [] }).map((tax) => ({ level: "store", name: tax.name, type: tax.type, value: tax.value })),
  ]
}

/** What one sellable thing (a product without variants, or one variant) is charged, per unit and per pack. */
function figures(row, { discountRule, category, isWeightBased }) {
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
    const discount = money(parts.own + parts.fromCategory)
    out.pack_discount_value = discount
    out.pack_tax_value = lineTaxAmount(TAX_ONLY_STORE, priced, catalogCategory, money(Number(row.pack_selling_price) - discount), size)
  }
  return out
}

const packOf = (row) =>
  row.is_pack_product && Number(row.pack_size) >= 2
    ? { size: Number(row.pack_size), price: row.pack_selling_price, cost: row.pack_cost_price }
    : null

/** The product views of a page (the views listProducts gives) in the register's shape. */
export async function posSaleProducts(views, currency) {
  const refs = await new Refs().loadAll({ category: views.map((view) => view.category_id) })
  return views.map((view) => {
    const category = categoryOf(view, refs)
    const hasVariants = Boolean(view.has_variants)
    const base = {
      id: view.product_number,
      title: view.title,
      sku: view.sku,
      barcode: view.barcode,
      category,
      image: view.featured_image || null,
      unit: view.unit,
      status: view.is_active ? "active" : "inactive",
      currency,
    }
    if (hasVariants) {
      const variants = (view.variants || []).filter((row) => row.is_active !== false)
      return {
        ...base,
        total_variants: variants.length,
        is_weight_based: null,
        price: null,
        cost_price: null,
        pack: null,
        sell_loose: null,
        discount: null,
        taxes: null,
        pack_discount_value: null,
        unit_discount_value: null,
        pack_tax_value: null,
        unit_tax_value: null,
        variants: variants.map((row) => ({
          id: row.variant_number,
          name: row.name,
          sku: row.sku,
          barcode: row.barcode,
          image: row.image || null,
          is_weight_based: Boolean(row.is_weight_based),
          price: row.selling_price,
          cost_price: row.cost_price,
          pack: packOf(row),
          sell_loose: row.is_pack_product ? Boolean(row.sell_loose) : true,
          // A variant has no product level discount: the category's applies.
          discount: null,
          ...figures(row, { discountRule: {}, category, isWeightBased: Boolean(row.is_weight_based) }),
          taxes: taxList(row),
        })),
      }
    }
    const hasDiscount = Boolean(view.has_product_discount) && view.discount_type && view.discount_value != null
    const discountRule = hasDiscount
      ? { has_product_discount: true, discount_type: view.discount_type, discount_value: view.discount_value, discount_applies_to: view.discount_applies_to || "all", is_weight_based: view.is_weight_based }
      : {}
    return {
      ...base,
      total_variants: null,
      is_weight_based: Boolean(view.is_weight_based),
      price: view.selling_price == null ? null : Number(view.selling_price),
      cost_price: view.cost_price == null ? null : Number(view.cost_price),
      pack: packOf(view),
      sell_loose: view.is_pack_product ? Boolean(view.sell_loose) : true,
      discount: hasDiscount
        ? { name: view.discount_name || null, type: view.discount_type, value: Number(view.discount_value), applies_to: view.discount_applies_to || "all" }
        : null,
      ...figures(view, { discountRule, category, isWeightBased: Boolean(view.is_weight_based) }),
      taxes: taxList(view),
      variants: [],
    }
  })
}
