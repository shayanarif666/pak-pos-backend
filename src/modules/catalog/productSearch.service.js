import { Op } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { Product } from "./product.model.js"
import { Category } from "./category.model.js"
import { BRANCH_ROLES } from "../../shared/utils/locationScope.util.js"

/*
 * GET /products/search — the dashboard's product picker (e.g. Record stock movement): a few products at a
 * time, found by name, SKU or barcode, so a store with a lakh products never loads them all.
 *
 * q       the text: part of the title, SKU or barcode of the product or of one of its variants (a variant's
 *         match brings its product, with matched_variant). Empty = the newest products.
 * page    from 1;  limit 1–50 (default 20).
 * include_inactive  true = inactive products too (default: active only).
 * A manager / cashier only finds what is sold at their location.
 *
 * Order: exact barcode / SKU first (a scanner hit), then titles that start with q, then the rest by title.
 */

const imageOf = (row) => {
  if (!row) return null
  if (row.featured_image) return row.featured_image
  let list = row.images
  if (typeof list === "string") {
    try {
      list = JSON.parse(list)
    } catch {
      list = []
    }
  }
  const first = Array.isArray(list) ? list[0] : null
  return (typeof first === "string" ? first : first?.url) || null
}

const truthy = (value) => ["1", "true", "yes"].includes(String(value ?? "").trim().toLowerCase())

export async function searchProducts(actor, query = {}) {
  const text = String(query.q ?? query.search ?? "").trim()
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 20))
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const offset = (page - 1) * limit
  const activeOnly = !truthy(query.include_inactive ?? query.includeInactive)
  const branchLocation = BRANCH_ROLES.has(actor?.role) ? actor.location_id || null : null

  const base = { store_id: actor.store_id, deleted_at: null, ...(activeOnly ? { is_active: true } : {}) }
  const where = { ...base, parent_product_id: null }
  const and = []

  // A manager / cashier: the products sold at their location (all locations, or theirs among the selected).
  if (branchLocation) {
    and.push({
      [Op.or]: [
        { location_scope: "all" },
        { id: { [Op.in]: sequelize.literal(`(SELECT product_id FROM product_locations WHERE location_id = ${sequelize.escape(branchLocation)})`) } },
      ],
    })
  }

  // Variants whose SKU / barcode / name matches: they bring their product.
  const matchedVariants = new Map()
  if (text) {
    const like = `%${text}%`
    const variants = await Product.findAll({
      where: {
        ...base,
        parent_product_id: { [Op.ne]: null },
        [Op.or]: [{ sku: { [Op.like]: like } }, { barcode: { [Op.like]: like } }, { variant_name: { [Op.like]: like } }],
      },
      attributes: ["id", "parent_product_id", "variant_number", "variant_name", "sku", "barcode", "featured_image", "images"],
      limit: 500,
    })
    const lower = text.toLowerCase()
    for (const variant of variants) {
      const exact = [variant.barcode, variant.sku].some((value) => value && String(value).toLowerCase() === lower)
      const kept = matchedVariants.get(variant.parent_product_id)
      // One per product: an exact barcode / SKU hit wins.
      if (!kept || (exact && !kept.exact)) matchedVariants.set(variant.parent_product_id, { row: variant, exact })
    }
    and.push({
      [Op.or]: [
        { title: { [Op.like]: like } },
        { sku: { [Op.like]: like } },
        { barcode: { [Op.like]: like } },
        ...(matchedVariants.size ? [{ id: { [Op.in]: [...matchedVariants.keys()] } }] : []),
      ],
    })
  }
  if (and.length) where[Op.and] = and

  const q = sequelize.escape(text)
  const qStart = sequelize.escape(`${text}%`)
  const exactVariantIds = [...matchedVariants.entries()].filter(([, value]) => value.exact).map(([id]) => sequelize.escape(id))
  const order = text
    ? [
        [sequelize.literal(`(\`Product\`.\`barcode\` = ${q} OR \`Product\`.\`sku\` = ${q}${exactVariantIds.length ? ` OR \`Product\`.\`id\` IN (${exactVariantIds.join(",")})` : ""})`), "DESC"],
        [sequelize.literal(`(\`Product\`.\`title\` LIKE ${qStart})`), "DESC"],
        ["title", "ASC"],
      ]
    : [["created_at", "DESC"]]

  const { rows, count } = await Product.findAndCountAll({
    where,
    attributes: ["id", "product_number", "title", "sku", "barcode", "unit", "has_variants", "is_active", "category_id", "featured_image", "images"],
    include: [{ model: Category, attributes: ["category_number", "name"], required: false }],
    order,
    limit,
    offset,
    distinct: true,
  })

  // How many variants each product has, and what it holds in stock (at the manager's location only).
  const ids = rows.map((row) => row.id)
  const variantCounts = new Map()
  const stockTotals = new Map()
  if (ids.length) {
    const [counts] = await sequelize.query(
      "SELECT parent_product_id AS id, COUNT(*) AS n FROM products WHERE parent_product_id IN (:ids) AND deleted_at IS NULL GROUP BY parent_product_id",
      { replacements: { ids } }
    )
    for (const row of counts) variantCounts.set(row.id, Number(row.n))
    const [stocks] = await sequelize.query(
      `SELECT COALESCE(p.parent_product_id, p.id) AS id, SUM(s.qty) AS qty
         FROM product_stocks s JOIN products p ON p.id = s.product_id
        WHERE (p.id IN (:ids) OR p.parent_product_id IN (:ids)) AND p.deleted_at IS NULL${branchLocation ? " AND s.location_id = :location" : ""}
        GROUP BY COALESCE(p.parent_product_id, p.id)`,
      { replacements: { ids, location: branchLocation } }
    )
    for (const row of stocks) stockTotals.set(row.id, Math.round(Number(row.qty || 0) * 10000) / 10000)
  }

  const lower = text.toLowerCase()
  const data = rows.map((row) => {
    // A variant is shown as the match when it is an exact hit, or when the product itself did not match q.
    const found = matchedVariants.get(row.id)
    const productMatches = [row.title, row.sku, row.barcode].some((value) => value && String(value).toLowerCase().includes(lower))
    const variant = found && (found.exact || !productMatches) ? found : null
    return {
      id: row.product_number,
      title: row.title,
      sku: row.sku,
      barcode: row.barcode,
      image: imageOf(row),
      category: row.Category ? { id: row.Category.category_number, name: row.Category.name } : null,
      unit: row.unit,
      has_variants: Boolean(row.has_variants),
      total_variants: variantCounts.get(row.id) || 0,
      total_qty: stockTotals.get(row.id) || 0,
      is_active: Boolean(row.is_active),
      // The variant that matched q (its SKU / barcode / name), else null.
      matched_variant: variant
        ? { id: variant.row.variant_number, name: variant.row.variant_name, sku: variant.row.sku, barcode: variant.row.barcode, image: imageOf(variant.row) }
        : null,
      // true = q is exactly this product's (or the matched variant's) barcode or SKU: a scanner hit.
      exact: Boolean(text) && (Boolean(variant?.exact) || [row.barcode, row.sku].some((value) => value && String(value).toLowerCase() === lower)),
    }
  })
  return { rows: data, pagination: { page, limit, total: count, total_pages: Math.max(1, Math.ceil(count / limit)) } }
}
