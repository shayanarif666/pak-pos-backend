import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import {
  findLiveStoreBySlug,
  getContent,
  getShipping,
  getPublicStoreBySlug,
  getTheme,
} from "../stores/store.service.js"
import { listPublicBanners } from "../stores/banner.service.js"
import * as categoryService from "./category.service.js"
import * as productService from "./product.service.js"
import { listPublicReviews as listApprovedReviews } from "../reviews/review.service.js"

// /public/stores/:slug/... uses the slug; /public/site/... resolves it from the domain first.
function slugOf(req) {
  return req.params.slug || req.storeSlug
}

export const getSiteStore = asyncHandler(async (req, res) => {
  return apiResponse(res, 200, "OK", await getPublicStoreBySlug(slugOf(req)))
})

async function liveStore(slug) {
  const store = await findLiveStoreBySlug(slug)
  if (!store) throw new NotFoundError("Store not found")
  return store
}

export const getPublicTheme = asyncHandler(async (req, res) => {
  const store = await liveStore(slugOf(req))
  return apiResponse(res, 200, "OK", await getTheme(store.id))
})

export const getPublicContent = asyncHandler(async (req, res) => {
  const store = await liveStore(slugOf(req))
  return apiResponse(res, 200, "OK", await getContent(store.id))
})

export const getPublicShipping = asyncHandler(async (req, res) => {
  const store = await liveStore(slugOf(req))
  return apiResponse(res, 200, "OK", await getShipping(store.id))
})

export const getPublicBanners = asyncHandler(async (req, res) => {
  return apiResponse(res, 200, "OK", await listPublicBanners(slugOf(req)))
})

export const listPublicCategories = asyncHandler(async (req, res) => {
  const rows = await categoryService.listPublicCategories(slugOf(req))
  return apiResponse(res, 200, "OK", rows)
})

export const listPublicProducts = asyncHandler(async (req, res) => {
  const rows = await productService.listPublicProducts(slugOf(req), {
    categoryId: req.query.category_id,
  })
  return apiResponse(res, 200, "OK", rows)
})

export const getPublicProduct = asyncHandler(async (req, res) => {
  const product = await productService.getPublicProduct(
    slugOf(req),
    req.params.id
  )
  return apiResponse(res, 200, "OK", product)
})

export const getPublicProductReviews = asyncHandler(async (req, res) => {
  const rows = await listApprovedReviews(slugOf(req), req.params.id)
  return apiResponse(res, 200, "OK", rows)
})
