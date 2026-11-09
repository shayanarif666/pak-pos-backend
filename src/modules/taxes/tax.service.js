import { Op } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { StoreTax, StoreTaxProduct } from "./storeTax.model.js"
import { Product } from "../catalog/product.model.js"
import { AppError } from "../../shared/errors/AppError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { nextTaxNumber } from "../../shared/utils/counter.util.js"

const productsInclude = {
  model: StoreTaxProduct,
  as: "taxProducts",
  attributes: ["product_id"],
  include: [
    {
      model: Product,
      attributes: ["id", "product_number", "title", "sku", "parent_product_id", "variant_number", "variant_name"],
      include: [{ model: Product, as: "parent", attributes: ["id", "product_number", "title"] }],
    },
  ],
}

/**
 * A tax as the API returns it: id = tax_number (the UUID is uuid) and product_scope; the products it
 * applies to are not listed (a product lists its own taxes), only product_ids ([] for product_scope all).
 */
export function publicTax(row) {
  const json = row.toJSON ? row.toJSON() : row
  const products = (json.taxProducts || [])
    .map((link) => link.Product)
    .filter(Boolean)
    .map((product) => {
      const parent = product.parent || null
      return {
        id: parent ? parent.product_number : product.product_number,
        uuid: product.id,
        title: parent ? parent.title : product.title,
        variant: parent ? { id: product.variant_number, name: product.variant_name } : null,
      }
    })
  return {
    id: json.tax_number,
    uuid: json.id,
    name: json.name,
    type: json.type,
    value: Number(json.value),
    product_scope: json.product_scope,
    product_ids: products.map((row) => row.id),
    is_active: Boolean(json.is_active),
    created_at: json.created_at,
    updated_at: json.updated_at,
  }
}

/** A tax by its number (1, 2, 3…) or UUID. */
async function getTax(storeId, ref) {
  const value = String(ref ?? "").trim()
  const where = /^\d+$/.test(value) ? { store_id: storeId, tax_number: Number(value) } : { store_id: storeId, id: value }
  const row = await StoreTax.findOne({ where, include: [productsInclude] })
  if (!row) throw new NotFoundError("Tax not found")
  return row
}

/** product_ids → product UUIDs: a product (covers its variants) or product + variant_id (one variant). */
async function productUuids(storeId, list) {
  const ids = []
  for (const { product_ref, variant_ref } of list) {
    const product = await Product.findOne({
      where: /^\d+$/.test(product_ref) ? { store_id: storeId, product_number: Number(product_ref) } : { store_id: storeId, id: product_ref },
      attributes: ["id", "title", "has_variants"],
    })
    if (!product) throw new NotFoundError(`Product ${product_ref} not found`)
    if (!variant_ref) {
      ids.push(product.id)
      continue
    }
    if (!product.has_variants) throw new AppError(`${product.title} has no variants: leave variant_id out`, 400)
    const variant = await Product.findOne({
      where: /^\d+$/.test(variant_ref)
        ? { store_id: storeId, parent_product_id: product.id, variant_number: Number(variant_ref), deleted_at: null }
        : { store_id: storeId, parent_product_id: product.id, id: variant_ref, deleted_at: null },
      attributes: ["id"],
    })
    if (!variant) throw new NotFoundError(`Variant ${variant_ref} of ${product.title} not found`)
    ids.push(variant.id)
  }
  return [...new Set(ids)]
}

async function replaceProducts(tax, ids, transaction) {
  await StoreTaxProduct.destroy({ where: { tax_id: tax.id }, transaction })
  if (ids.length) {
    await StoreTaxProduct.bulkCreate(ids.map((product_id) => ({ tax_id: tax.id, product_id })), { transaction })
  }
}

export async function listTaxes(storeId, query = {}) {
  const where = { store_id: storeId }
  if (query.is_active !== undefined && query.is_active !== "") where.is_active = !["false", "0"].includes(String(query.is_active))
  if (query.product_scope) where.product_scope = query.product_scope
  if (query.q) where.name = { [Op.like]: `%${String(query.q).trim()}%` }
  const rows = await StoreTax.findAll({ where, include: [productsInclude], order: [["tax_number", "ASC"]] })
  return rows.map(publicTax)
}

export async function getTaxView(storeId, ref) {
  return publicTax(await getTax(storeId, ref))
}

export async function createTax(store, fields, actor) {
  const ids = fields.product_scope === "selected" ? await productUuids(store.id, fields.product_ids) : []
  const id = await sequelize.transaction(async (transaction) => {
    const tax = await StoreTax.create(
      {
        store_id: store.id,
        store_id_int: store.store_id_int,
        tax_number: await nextTaxNumber(store.id, transaction),
        name: fields.name,
        type: fields.type,
        value: fields.value,
        product_scope: fields.product_scope,
        is_active: fields.is_active,
        created_by: actor?.id || null,
      },
      { transaction }
    )
    await replaceProducts(tax, ids, transaction)
    return tax.id
  })
  return getTaxView(store.id, id)
}

export async function updateTax(storeId, ref, fields) {
  const tax = await getTax(storeId, ref)
  const { product_ids, ...patch } = fields
  const type = patch.type ?? tax.type
  if (type === "percentage" && Number(patch.value ?? tax.value) > 100) {
    throw new AppError("a percentage value cannot exceed 100", 400)
  }
  const scope = patch.product_scope ?? tax.product_scope
  let ids
  if (scope === "all") ids = []
  else if (product_ids !== undefined) ids = await productUuids(storeId, product_ids)
  else if (patch.product_scope === "selected" && !(tax.taxProducts || []).length) {
    throw new AppError("product_ids is required when product_scope is selected", 400)
  }
  await sequelize.transaction(async (transaction) => {
    await tax.update(patch, { transaction })
    if (ids !== undefined) await replaceProducts(tax, ids, transaction)
  })
  return getTaxView(storeId, tax.id)
}

export async function deleteTax(storeId, ref) {
  const tax = await getTax(storeId, ref)
  await tax.destroy()
  return { id: tax.tax_number, deleted: true }
}

/**
 * The active store taxes, ready to match products: taxesFor(product) gives the ones that apply to
 * a product or variant — product_scope all, or selected with it (or its parent) listed.
 */
export async function storeTaxMatcher(storeId) {
  const rows = await StoreTax.findAll({
    where: { store_id: storeId, is_active: true },
    include: [{ model: StoreTaxProduct, as: "taxProducts", attributes: ["product_id"] }],
    order: [["tax_number", "ASC"]],
  })
  const taxes = rows.map((row) => ({
    view: { id: row.tax_number, name: row.name, type: row.type, value: Number(row.value) },
    all: row.product_scope === "all",
    products: new Set((row.taxProducts || []).map((link) => link.product_id)),
  }))
  return (product, parentId = null) =>
    taxes
      .filter((tax) => tax.all || tax.products.has(product.id) || (parentId && tax.products.has(parentId)))
      .map((tax) => tax.view)
}
