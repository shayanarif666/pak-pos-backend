import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { getStoreForManager } from "./store.service.js"
import * as bannerService from "./banner.service.js"

export const list = asyncHandler(async (req, res) => {
  const data = await bannerService.listBanners(req.storeId)
  return apiResponse(res, 200, "OK", data)
})

export const create = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const data = await bannerService.createBanner(store, req.body)
  return apiResponse(res, 201, "Banner created", data)
})

export const patch = asyncHandler(async (req, res) => {
  const data = await bannerService.patchBanner(req.storeId, req.params.id, req.body)
  return apiResponse(res, 200, "Banner updated", data)
})

export const remove = asyncHandler(async (req, res) => {
  await bannerService.deleteBanner(req.storeId, req.params.id)
  return apiResponse(res, 200, "Banner deleted", null)
})

export const listPublic = asyncHandler(async (req, res) => {
  const data = await bannerService.listPublicBanners(req.params.slug)
  return apiResponse(res, 200, "OK", data)
})
