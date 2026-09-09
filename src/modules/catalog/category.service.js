import { ForeignKeyConstraintError, UniqueConstraintError } from "sequelize"
import { Category } from "./category.model.js"
import { Product } from "./product.model.js"
import { slugify } from "../../shared/utils/slugify.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { AppError } from "../../shared/errors/AppError.js"
import { findLiveStoreBySlug } from "../stores/store.service.js"

function publicCategory(row) {
  const json = row.toJSON ? row.toJSON() : row
  return {
    id: json.id,
    store_id: json.store_id,
    name: json.name,
    slug: json.slug,
    parent_category_id: json.parent_category_id,
    image_url: json.image_url,
    description: json.description,
    tax_type: json.tax_type,
    tax_value: json.tax_value == null ? null : Number(json.tax_value),
    discount_type: json.discount_type,
    discount_value: json.discount_value == null ? null : Number(json.discount_value),
    is_active: json.is_active,
    sort_order: json.sort_order,
    pos_visible: json.pos_visible,
    web_visible: json.web_visible,
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
  const slug = slugify(fields.slug || fields.name)
  if (!slug) throw new AppError("slug is required", 400)
  await assertUniqueSlug(store.id, slug)

  try {
    const row = await Category.create({
      store_id: store.id,
      store_id_int: store.store_id_int,
      name: fields.name,
      slug,
      parent_category_id: await resolveParent(store.id, fields.parent_category_id),
      image_url: fields.image_url,
      description: fields.description,
      tax_type: fields.tax_type,
      tax_value: fields.tax_value,
      discount_type: fields.discount_type,
      discount_value: fields.discount_value,
      is_active: fields.is_active,
      sort_order: fields.sort_order,
      pos_visible: fields.pos_visible,
      web_visible: fields.web_visible,
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
      web_visible: true,
    },
    order: [
      ["sort_order", "ASC"],
      ["name", "ASC"],
    ],
  })
  return rows.map(publicCategory)
}
