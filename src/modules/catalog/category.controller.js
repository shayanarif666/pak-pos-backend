import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { getStoreForManager } from "../stores/store.service.js"
import { bulkStatus, extractBulkItems, runBulk } from "../../shared/utils/bulk.util.js"
import { parseCreateCategory } from "./category.validation.js"
import * as categoryService from "./category.service.js"

export const list = asyncHandler(async (req, res) => {
  const rows = await categoryService.listCategories(req.storeId)
  return apiResponse(res, 200, "OK", rows)
})

export const getOne = asyncHandler(async (req, res) => {
  const data = await categoryService.getCategoryView(req.storeId, req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const create = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const category = await categoryService.createCategory(store, req.body)
  return apiResponse(res, 201, "Category created", category)
})

export const createBulk = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    return categoryService.createCategory(store, parseCreateCategory(item))
  })
  return apiResponse(res, bulkStatus(data), "Bulk categories processed", data)
})

export const patch = asyncHandler(async (req, res) => {
  const category = await categoryService.updateCategory(
    req.storeId,
    req.params.id,
    req.body
  )
  return apiResponse(res, 200, "Category updated", category)
})

export const remove = asyncHandler(async (req, res) => {
  await categoryService.deleteCategory(req.storeId, req.params.id)
  return apiResponse(res, 200, "Category deleted", null)
})
