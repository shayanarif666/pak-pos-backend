import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { getStoreForManager } from "../stores/store.service.js"
import * as productService from "./product.service.js"

export const list = asyncHandler(async (req, res) => {
  const data = await productService.listProducts(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const getOne = asyncHandler(async (req, res) => {
  const data = await productService.getProductView(req.user, req.params.id, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const create = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const product = await productService.createProduct(store, req.body)
  return apiResponse(res, 201, "Product created", product)
})

export const patch = asyncHandler(async (req, res) => {
  const product = await productService.updateProduct(
    req.storeId,
    req.params.id,
    req.body
  )
  return apiResponse(res, 200, "Product updated", product)
})

export const remove = asyncHandler(async (req, res) => {
  const product = await productService.deleteProduct(req.storeId, req.params.id)
  return apiResponse(res, 200, "Product disabled", product)
})

export const listWeight = asyncHandler(async (req, res) => {
  const data = await productService.listWeightProducts(req.storeId)
  return apiResponse(res, 200, "OK", data)
})

export const patchWeight = asyncHandler(async (req, res) => {
  const data = await productService.patchWeight(req.storeId, req.params.id, req.body)
  return apiResponse(res, 200, "Weight setting updated", data)
})

export const listExpiry = asyncHandler(async (req, res) => {
  const data = await productService.listExpiryProducts(req.storeId)
  return apiResponse(res, 200, "OK", data)
})

export const listBulkTiers = asyncHandler(async (req, res) => {
  const data = await productService.listBulkTiers(req.storeId, req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const putBulkTiers = asyncHandler(async (req, res) => {
  const data = await productService.replaceBulkTiers(
    req.storeId,
    req.params.id,
    req.body.tiers
  )
  return apiResponse(res, 200, "Bulk tiers saved", data)
})
