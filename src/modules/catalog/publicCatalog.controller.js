import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import {
  findLiveStoreBySlug,
  getContent,
  getShipping,
  getTheme,
} from "../stores/store.service.js"
import { listPublicBanners } from "../stores/banner.service.js"
import * as categoryService from "./category.service.js"
import * as productService from "./product.service.js"
import { listPublicReviews as listApprovedReviews } from "../reviews/review.service.js"

async function liveStore(slug) {
  const store = await findLiveStoreBySlug(slug)
  if (!store) throw new NotFoundError("Store not found")
  return store
}

export const getPublicTheme = asyncHandler(async (req, res) => {
  const store = await liveStore(req.params.slug)
  return apiResponse(res, 200, "OK", await getTheme(store.id))
})

export const getPublicContent = asyncHandler(async (req, res) => {
  const store = await liveStore(req.params.slug)
  return apiResponse(res, 200, "OK", await getContent(store.id))
})

export const getPublicShipping = asyncHandler(async (req, res) => {
  const store = await liveStore(req.params.slug)
  return apiResponse(res, 200, "OK", await getShipping(store.id))
})

export const getPublicBanners = asyncHandler(async (req, res) => {
  return apiResponse(res, 200, "OK", await listPublicBanners(req.params.slug))
})

export const listPublicCategories = asyncHandler(async (req, res) => {
  const rows = await categoryService.listPublicCategories(req.params.slug)
  return apiResponse(res, 200, "OK", rows)
})

export const listPublicProducts = asyncHandler(async (req, res) => {
  const rows = await productService.listPublicProducts(req.params.slug, {
    categoryId: req.query.category_id,
  })
  return apiResponse(res, 200, "OK", rows)
})

export const getPublicProduct = asyncHandler(async (req, res) => {
  const product = await productService.getPublicProduct(
    req.params.slug,
    req.params.id
  )
  return apiResponse(res, 200, "OK", product)
})

export const getPublicProductReviews = asyncHandler(async (req, res) => {
  const rows = await listApprovedReviews(req.params.slug, req.params.id)
  return apiResponse(res, 200, "OK", rows)
})
