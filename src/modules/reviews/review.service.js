import { UniqueConstraintError } from "sequelize"
import { Review } from "./review.model.js"
import { Product } from "../catalog/product.model.js"
import { User } from "../auth/user.model.js"
import { findLiveStoreBySlug, getStoreForManager } from "../stores/store.service.js"
import { writeAudit } from "../../shared/utils/audit.util.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

function publicReview(row) {
  const json = row.toJSON ? row.toJSON() : row
  return {
    id: json.id,
    store_id: json.store_id,
    product_id: json.product_id,
    user_id: json.user_id,
    rating: json.rating,
    comment: json.comment,
    status: json.status,
    reviewed_by: json.reviewed_by,
    reviewed_at: json.reviewed_at,
    created_at: json.created_at,
    updated_at: json.updated_at,
    reviewer_name: json.User?.name || null,
    product_title: json.Product?.title || null,
  }
}

async function getReview(storeId, id) {
  const row = await Review.findOne({
    where: { id, store_id: storeId },
    include: [
      { model: User, attributes: ["id", "name"] },
      { model: Product, attributes: ["id", "title"] },
    ],
  })
  if (!row) throw new NotFoundError("Review not found")
  return row
}

export async function createReview(actor, fields) {
  if (actor.role !== "customer") {
    throw new AppError("Only customers can submit reviews", 403)
  }
  const store = await getStoreForManager(actor.store_id)
  const product = await Product.findOne({
    where: {
      id: fields.product_id,
      store_id: store.id,
      is_active: true,
      is_published: true,
      web_visible: true,
    },
  })
  if (!product) throw new NotFoundError("Product not found")

  try {
    const row = await Review.create({
      store_id: store.id,
      store_id_int: store.store_id_int,
      product_id: product.id,
      user_id: actor.id,
      rating: fields.rating,
      comment: fields.comment,
      status: "pending",
    })
    return publicReview(row)
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new ConflictError("You already reviewed this product")
    }
    throw err
  }
}

export async function listReviews(actor, query = {}) {
  const store = await getStoreForManager(actor.store_id)
  const where = { store_id: store.id }
  if (query.status) where.status = query.status
  if (query.product_id) where.product_id = query.product_id
  const rows = await Review.findAll({
    where,
    include: [
      { model: User, attributes: ["id", "name"] },
      { model: Product, attributes: ["id", "title"] },
    ],
    order: [["created_at", "DESC"]],
  })
  return rows.map(publicReview)
}

export async function moderateReview(actor, id, fields) {
  const store = await getStoreForManager(actor.store_id)
  const row = await getReview(store.id, id)
  await row.update({
    status: fields.status,
    reviewed_by: actor.id,
    reviewed_at: new Date(),
  })
  await writeAudit({
    action: "update",
    entity_type: "reviews",
    entity_id: row.id,
    store_id: store.id,
    store_id_int: store.store_id_int,
    user_id: actor.id,
    channel: "web",
    note: fields.status,
  })
  return publicReview(await getReview(store.id, id))
}

export async function listPublicReviews(slug, productId) {
  const store = await findLiveStoreBySlug(slug)
  if (!store) throw new NotFoundError("Store not found")
  const product = await Product.findOne({
    where: {
      id: productId,
      store_id: store.id,
      is_published: true,
      web_visible: true,
      is_active: true,
    },
  })
  if (!product) throw new NotFoundError("Product not found")

  const rows = await Review.findAll({
    where: {
      store_id: store.id,
      product_id: product.id,
      status: "approved",
    },
    include: [{ model: User, attributes: ["id", "name"] }],
    order: [["created_at", "DESC"]],
  })
  return rows.map(publicReview)
}
