import { AppError } from "../../shared/errors/AppError.js"
import { SUPPLIER_LOCATION_SCOPE, TAX_AMOUNT_TYPE } from "../../db/enums.js"

const REF_RE = /^([1-9][0-9]*|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i

function ref(value, label) {
  const text = String(value ?? "").trim()
  if (!REF_RE.test(text)) throw new AppError(`${label} must be a number or a UUID`, 400)
  return text
}

/**
 * product_ids: the products the tax applies to — numbers / UUIDs, or { product_id, variant_id }
 * for one variant only (a product alone covers all its variants).
 */
function parseProductIds(body) {
  const raw = body.product_ids ?? body.products
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) throw new AppError("product_ids must be an array", 400)
  const seen = new Set()
  const list = []
  raw.forEach((entry, index) => {
    const row = entry && typeof entry === "object" ? entry : { product_id: entry }
    const product_ref = ref(row.product_id ?? row.productId ?? row.id, `product_ids[${index}]`)
    const variantValue = row.variant_id ?? row.variantId
    const variant_ref = variantValue == null || variantValue === "" ? null : ref(variantValue, `product_ids[${index}].variant_id`)
    const key = `${product_ref}|${variant_ref || ""}`
    if (seen.has(key)) return
    seen.add(key)
    list.push({ product_ref, variant_ref })
  })
  return list
}

function parseType(body) {
  const type = String(body.type ?? body.taxType ?? body.tax_type ?? "")
  if (!TAX_AMOUNT_TYPE.includes(type)) throw new AppError("type must be percentage or fixed", 400)
  return type
}

function parseValue(body, type) {
  const raw = body.value ?? body.amount ?? body.tax_value
  const value = Number(raw)
  if (raw === undefined || raw === null || raw === "" || Number.isNaN(value) || value < 0) {
    throw new AppError("value must be a number >= 0", 400)
  }
  if (type === "percentage" && value > 100) throw new AppError("a percentage value cannot exceed 100", 400)
  return value
}

function parseName(body) {
  const name = String(body.name ?? body.taxName ?? body.tax_name ?? "").trim()
  if (!name) throw new AppError("name is required", 400)
  if (name.length > 255) throw new AppError("name is too long", 400)
  return name
}

function parseActive(body) {
  const value = body.is_active
  if (value === undefined || value === null) return undefined
  if (value === "false" || value === 0 || value === "0") return false
  return Boolean(value)
}

/** product_scope all (every product) | selected (product_ids). Only product_ids sent = selected. */
function parseScope(body, productIds, { creating }) {
  const sent = body.product_scope ?? body.productScope
  if (sent === undefined || sent === null || sent === "") {
    if (productIds !== undefined) return productIds.length ? "selected" : "all"
    return creating ? "all" : undefined
  }
  const scope = String(sent)
  if (!SUPPLIER_LOCATION_SCOPE.includes(scope)) throw new AppError("product_scope must be all or selected", 400)
  return scope
}

export function parseCreateTax(body) {
  const type = parseType(body)
  const product_ids = parseProductIds(body)
  const product_scope = parseScope(body, product_ids, { creating: true })
  if (product_scope === "selected" && !product_ids?.length) {
    throw new AppError("product_ids is required when product_scope is selected", 400)
  }
  return {
    name: parseName(body),
    type,
    value: parseValue(body, type),
    product_scope,
    // "all" needs no list: every product, including ones added later.
    product_ids: product_scope === "selected" ? product_ids : [],
    is_active: parseActive(body) ?? true,
  }
}

export function parsePatchTax(body) {
  const fields = {}
  if (body.name !== undefined || body.taxName !== undefined || body.tax_name !== undefined) fields.name = parseName(body)
  const typeSent = body.type !== undefined || body.taxType !== undefined || body.tax_type !== undefined
  if (typeSent) fields.type = parseType(body)
  if (body.value !== undefined || body.amount !== undefined || body.tax_value !== undefined) {
    fields.value = parseValue(body, fields.type || "fixed")
  }
  const product_ids = parseProductIds(body)
  const product_scope = parseScope(body, product_ids, { creating: false })
  if (product_scope !== undefined) fields.product_scope = product_scope
  if (product_ids !== undefined) fields.product_ids = product_ids
  if (fields.product_scope === "selected" && product_ids !== undefined && !product_ids.length) {
    throw new AppError("product_ids is required when product_scope is selected", 400)
  }
  const active = parseActive(body)
  if (active !== undefined) fields.is_active = active
  if (!Object.keys(fields).length) throw new AppError("No fields to update", 400)
  return fields
}
