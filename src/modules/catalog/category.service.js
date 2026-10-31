import { ForeignKeyConstraintError, Op, UniqueConstraintError } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { Category } from "./category.model.js"
import { CategoryLocation } from "./catalogLocation.model.js"
import { Location } from "../locations/location.model.js"
import {
  BRANCH_ROLES,
  locationScopeView,
  replaceLocationLinks,
  resolveStoreLocations,
  scopeForActor,
  soldAt,
} from "../../shared/utils/locationScope.util.js"
import { Product } from "./product.model.js"
import { ensureUniqueSlug } from "../../shared/utils/slugify.js"
import { nextCategoryNumber } from "../../shared/utils/counter.util.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { AppError } from "../../shared/errors/AppError.js"
import { parseCatalogVisibility, publicVisibility } from "../../db/channelVisibility.js"

export const CATEGORY_LOCATIONS_INCLUDE = {
  model: CategoryLocation,
  as: "categoryLocations",
  attributes: ["location_id"],
  include: [{ model: Location, attributes: ["id", "location_id_int", "name"] }],
}

/** Managers and cashiers see their own location; a store admin every one (or ?location_id=). */
export function viewerLocationId(actor, query = {}) {
  if (BRANCH_ROLES.has(actor?.role)) return actor.location_id || null
  return query.location_id || query.locationId || null
}

/** Whether the category is sold at locationId (scope "all", or that location is selected). */
export function categorySoldAt(category, locationId) {
  const json = category?.toJSON ? category.toJSON() : category
  return soldAt(json, json?.categoryLocations, locationId)
}

export function publicCategory(row) {
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
    // "all" = every location; "selected" = only location_ids.
    ...locationScopeView(json, json.categoryLocations),
    ...publicVisibility(json),
    created_at: json.created_at,
    updated_at: json.updated_at,
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

export async function listCategories(storeId, actor = null, query = {}) {
  const locationId = viewerLocationId(actor, query)
  const rows = await Category.findAll({
    where: { store_id: storeId },
    include: [CATEGORY_LOCATIONS_INCLUDE],
    order: [
      ["sort_order", "ASC"],
      ["name", "ASC"],
    ],
  })
  return rows.filter((row) => categorySoldAt(row, locationId)).map(publicCategory)
}

export async function getCategory(storeId, id, actor = null) {
  const category = await Category.findOne({
    where: { id, store_id: storeId },
    include: [CATEGORY_LOCATIONS_INCLUDE],
  })
  if (!category) throw new NotFoundError("Category not found")
  if (BRANCH_ROLES.has(actor?.role) && !categorySoldAt(category, actor.location_id)) {
    throw new NotFoundError("Category not found")
  }
  return category
}

export async function getCategoryView(storeId, id, actor = null) {
  return publicCategory(await getCategory(storeId, id, actor))
}

export async function createCategory(store, input, actor = null) {
  const { location_ids, ...fields } = scopeForActor(actor, input, { creating: true })
  const scope = fields.location_scope || "all"
  // Creating the same category again is allowed: the slug gets a -2, -3... suffix instead of a
  // 409, so storefront lookups by slug stay unambiguous.
  const slug = await ensureUniqueSlug(fields.slug || fields.name, async (candidate) =>
    Boolean(await Category.findOne({ where: { store_id: store.id, slug: candidate } }))
  )
  if (!slug) throw new AppError("slug is required", 400)

  try {
    const id = await sequelize.transaction(async (transaction) => {
      const locationIds = await resolveStoreLocations(
        store.id,
        scope === "selected" ? location_ids : [],
        transaction
      )
      const row = await Category.create(
        {
          store_id: store.id,
          store_id_int: store.store_id_int,
          category_number: await nextCategoryNumber(store.id, transaction),
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
          location_scope: scope,
        },
        { transaction }
      )
      await replaceLocationLinks(CategoryLocation, "category_id", row, locationIds, transaction)
      return row.id
    })
    return publicCategory(await getCategory(store.id, id))
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new ConflictError("Category slug already exists")
    }
    throw err
  }
}

export async function updateCategory(storeId, id, input, actor = null) {
  const category = await getCategory(storeId, id, actor)
  const { location_ids, ...fields } = scopeForActor(actor, input, { creating: false })
  const patch = { ...fields }

  if (fields.slug !== undefined || fields.name !== undefined) {
    // A name already used by another category is fine: the slug just gets a -2, -3... suffix.
    const slug = await ensureUniqueSlug(
      fields.slug || fields.name || category.name,
      async (candidate) =>
        Boolean(
          await Category.findOne({
            where: { store_id: storeId, slug: candidate, id: { [Op.ne]: category.id } },
          })
        )
    )
    if (!slug) throw new AppError("slug is required", 400)
    patch.slug = slug
  }

  if (fields.parent_category_id !== undefined) {
    patch.parent_category_id = await resolveParent(storeId, fields.parent_category_id, category.id)
  }

  try {
    await sequelize.transaction(async (transaction) => {
      if (fields.location_scope !== undefined) {
        const ids = await resolveStoreLocations(
          storeId,
          fields.location_scope === "selected" ? location_ids : [],
          transaction
        )
        await replaceLocationLinks(CategoryLocation, "category_id", category, ids, transaction)
      }
      await category.update(patch, { transaction })
    })
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new ConflictError("Category slug already exists")
    }
    throw err
  }
  return publicCategory(await getCategory(storeId, category.id))
}

export async function deleteCategory(storeId, id) {
  const category = await getCategory(storeId, id)
  const productCount = await Product.count({ where: { category_id: id } })
  if (productCount > 0) {
    throw new ConflictError("Cannot delete category while products still reference it")
  }

  try {
    await category.destroy()
  } catch (err) {
    if (err instanceof ForeignKeyConstraintError) {
      throw new ConflictError("Cannot delete category while products still reference it")
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
