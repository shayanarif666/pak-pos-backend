import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as storeService from "./store.service.js"

export const getMyStore = asyncHandler(async (req, res) => {
  const store = await storeService.getMyStoreView(req.storeId)
  return apiResponse(res, 200, "OK", store)
})

export const patchMyStore = asyncHandler(async (req, res) => {
  const store = await storeService.updateStoreForManager(req.storeId, req.body)
  return apiResponse(res, 200, "Store updated", store)
})

export const getTheme = asyncHandler(async (req, res) => {
  const theme = await storeService.getTheme(req.storeId)
  return apiResponse(res, 200, "OK", theme)
})

export const putTheme = asyncHandler(async (req, res) => {
  const store = await storeService.getStoreForManager(req.storeId)
  const theme = await storeService.upsertTheme(store, req.body)
  return apiResponse(res, 200, "Theme saved", theme)
})

export const getContent = asyncHandler(async (req, res) => {
  const content = await storeService.getContent(req.storeId)
  return apiResponse(res, 200, "OK", content)
})

export const putContent = asyncHandler(async (req, res) => {
  const store = await storeService.getStoreForManager(req.storeId)
  const content = await storeService.upsertContent(store, req.body)
  return apiResponse(res, 200, "Content saved", content)
})

export const getShipping = asyncHandler(async (req, res) => {
  const shipping = await storeService.getShipping(req.storeId)
  return apiResponse(res, 200, "OK", shipping)
})

export const putShipping = asyncHandler(async (req, res) => {
  const store = await storeService.getStoreForManager(req.storeId)
  const shipping = await storeService.upsertShipping(store, req.body)
  return apiResponse(res, 200, "Shipping saved", shipping)
})

export const getBySlug = asyncHandler(async (req, res) => {
  const data = await storeService.getPublicStoreBySlug(req.params.slug)
  return apiResponse(res, 200, "OK", data)
})
