import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { getStoreForManager } from "../stores/store.service.js"
import { bulkStatus, posBulkResponse, extractBulkItems, runBulk } from "../../shared/utils/bulk.util.js"
import { parseCreateProduct } from "./product.validation.js"
import { posProduct, posProducts } from "../pos/posResponses.js"
import * as productService from "./product.service.js"
import * as posHistory from "../pos/posHistory.service.js"

export const list = asyncHandler(async (req, res) => {
  if (req.auth?.channel === "pos") return posHistory.sendPage(res, await posHistory.products(req))
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
  if (req.auth?.channel === "pos") {
    // Every field, with short numbers (id = product_number, category_id = category_number).
    return apiResponse(res, 201, "Products Created", await posProduct(product))
  }
  return apiResponse(res, 201, "Product created", product)
})

export const createBulk = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    return productService.createProduct(store, parseCreateProduct(item))
  })
  if (req.auth?.channel === "pos") {
    const created = []
    created.push(...(await posProducts(data.created)))
    return posBulkResponse(res, data, "Products Created", created)
  }
  return apiResponse(res, bulkStatus(data), "Bulk products processed", data)
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
  if (req.auth?.channel === "pos") return posHistory.sendPage(res, await posHistory.weightList(req))
  const data = await productService.listWeightProducts(req.storeId)
  return apiResponse(res, 200, "OK", data)
})

export const patchWeight = asyncHandler(async (req, res) => {
  const data = await productService.patchWeight(req.storeId, req.params.id, req.body)
  return apiResponse(res, 200, "Weight setting updated", data)
})

export const listExpiry = asyncHandler(async (req, res) => {
  if (req.auth?.channel === "pos") return posHistory.sendPage(res, await posHistory.expiryList(req))
  // A manager sees their own location; a store admin every location (or ?location_id=).
  const locationId =
    req.user.role === "store_admin" ? req.query.location_id || null : req.auth?.location_id || req.user.location_id
  const data = await productService.listExpiryProducts(req.storeId, locationId)
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
