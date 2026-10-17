import { ForeignKeyConstraintError, UniqueConstraintError } from "sequelize"
import { Category } from "./category.model.js"
import { Product } from "./product.model.js"
import { ensureUniqueSlug, slugify } from "../../shared/utils/slugify.js"
import { nextCategoryNumber } from "../../shared/utils/counter.util.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { AppError } from "../../shared/errors/AppError.js"
import { parseCatalogVisibility, publicVisibility } from "../../db/channelVisibility.js"

function publicCategory(row) {
  const json = row.toJSON ? row.toJSON() : row
  return {
    id: json.id,
    store_id: json.store_id,
    store_number: json.store_id_int,
    category_number: json.category_number,
    name: json.name,
    slug: json.slug,
    parent_category_id: json.parent_category_id,
    image_url: json.image_url,
    description: json.description,
    tax_type: json.tax_type,
    tax_value: json.tax_value == null ? null : Number(json.tax_value),
    tax_name: json.tax_name,
    discount_type: json.discount_type,
    discount_value: json.discount_value == null ? null : Number(json.discount_value),
    discount_name: json.discount_name,
    is_active: json.is_active,
    sort_order: json.sort_order,
    ...publicVisibility(json),
    created_at: json.created_at,
    updated_at: json.updated_at,
  }
}

async function assertUniqueSlug(storeId, slug, excludeId) {
  const existing = await Category.findOne({ where: { store_id: storeId, slug } })
  if (existing && existing.id !== excludeId) {
    throw new ConflictError("Category slug already exists")
  }
}

async function resolveParent(storeId, parentId, selfId) {
  if (!parentId) return null
  if (selfId && parentId === selfId) {
    throw new AppError("Category cannot be its own parent", 400)
  }
  const parent = await Category.findOne({
    where: { id: parentId, store_id: storeId },
  })
  if (!parent) throw new NotFoundError("Parent category not found")
  return parent.id
}

export async function listCategories(storeId) {
  const rows = await Category.findAll({
    where: { store_id: storeId },
    order: [
      ["sort_order", "ASC"],
      ["name", "ASC"],
    ],
  })
  return rows.map(publicCategory)
}

export async function getCategory(storeId, id) {
  const category = await Category.findOne({
    where: { id, store_id: storeId },
  })
  if (!category) throw new NotFoundError("Category not found")
  return category
}

export async function getCategoryView(storeId, id) {
  return publicCategory(await getCategory(storeId, id))
}

export async function createCategory(store, fields) {
  // Creating the same category again is allowed: the slug gets a -2, -3... suffix instead of a
  // 409, so storefront lookups by slug stay unambiguous.
  const slug = await ensureUniqueSlug(fields.slug || fields.name, async (candidate) =>
    Boolean(await Category.findOne({ where: { store_id: store.id, slug: candidate } }))
  )
  if (!slug) throw new AppError("slug is required", 400)

  try {
    const row = await Category.create({
      store_id: store.id,
      store_id_int: store.store_id_int,
      category_number: await nextCategoryNumber(store.id),
      name: fields.name,
      slug,
      parent_category_id: await resolveParent(store.id, fields.parent_category_id),
      image_url: fields.image_url,
      description: fields.description,
      tax_type: fields.tax_type,
      tax_value: fields.tax_value,
      tax_name: fields.tax_name,
      discount_type: fields.discount_type,
      discount_value: fields.discount_value,
      discount_name: fields.discount_name,
      is_active: fields.is_active,
      sort_order: fields.sort_order,
      is_pos_visible: fields.is_pos_visible,
      is_web_visible: fields.is_web_visible,
      channel: fields.channel,
    })
    return publicCategory(row)
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new ConflictError("Category slug already exists")
    }
    throw err
  }
}

export async function updateCategory(storeId, id, fields) {
  const category = await getCategory(storeId, id)
  const patch = { ...fields }

  if (fields.slug !== undefined || fields.name !== undefined) {
    const slug = slugify(fields.slug || fields.name || category.name)
    if (!slug) throw new AppError("slug is required", 400)
    await assertUniqueSlug(storeId, slug, category.id)
    patch.slug = slug
  }

  if (fields.parent_category_id !== undefined) {
    patch.parent_category_id = await resolveParent(
      storeId,
      fields.parent_category_id,
      category.id
    )
  }

  try {
    await category.update(patch)
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new ConflictError("Category slug already exists")
    }
    throw err
  }
  return publicCategory(category)
}

export async function deleteCategory(storeId, id) {
  const category = await getCategory(storeId, id)
  const productCount = await Product.count({ where: { category_id: id } })
  if (productCount > 0) {
    throw new ConflictError(
      "Cannot delete category while products still reference it"
    )
  }

  try {
    await category.destroy()
  } catch (err) {
    if (err instanceof ForeignKeyConstraintError) {
      throw new ConflictError(
        "Cannot delete category while products still reference it"
      )
    }
    throw err
  }
}

export async function listPublicCategories(slug) {
  const store = await findLiveStoreBySlug(slug)
  if (!store) throw new NotFoundError("Store not found")

  const rows = await Category.findAll({
    where: {
      store_id: store.id,
      is_active: true,
      is_web_visible: true,
    },
    order: [
      ["sort_order", "ASC"],
      ["name", "ASC"],
    ],
  })
  return rows.map(publicCategory)
}
