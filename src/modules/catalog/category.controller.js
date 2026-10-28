import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { getStoreForManager } from "../stores/store.service.js"
import { bulkStatus, posBulkResponse, extractBulkItems, runBulk } from "../../shared/utils/bulk.util.js"
import { parseCreateCategory, parsePatchCategory } from "./category.validation.js"
import { Category } from "./category.model.js"
import { AppError } from "../../shared/errors/AppError.js"
import {
  bulkUpdateResponse,
  optionalUuidOfNumber,
  requireBoolean,
  runBulkUpdate,
} from "../../shared/utils/bulkUpdate.util.js"
import { posCategories, posCategory } from "../pos/posResponses.js"
import * as categoryService from "./category.service.js"
import * as posHistory from "../pos/posHistory.service.js"

export const list = asyncHandler(async (req, res) => {
  if (req.auth?.channel === "pos") return posHistory.sendPage(res, await posHistory.categories(req))
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
  if (req.auth?.channel === "pos") {
    // Every field, with short numbers (id = category_number) — the POS stores the row as is.
    return apiResponse(res, 201, "Categories Created", await posCategory(category))
  }
  return apiResponse(res, 201, "Category created", category)
})

export const createBulk = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    return categoryService.createCategory(store, parseCreateCategory(item))
  })
  if (req.auth?.channel === "pos") {
    const created = []
    created.push(...(await posCategories(data.created)))
    return posBulkResponse(res, data, "Categories Created", created)
  }
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

// ---- Bulk updates (POS offline sync): items[] = [{ id (category number), ...fields }] ----

function bulkCategoryUpdate(parse, message) {
  return asyncHandler(async (req, res) => {
    const data = await runBulkUpdate(req.body, {
      model: Category,
      column: "category_number",
      label: "Category",
      storeId: req.storeId,
      handler: async (uuid, fields) => {
        const parent = await optionalUuidOfNumber(
          Category,
          "category_number",
          req.storeId,
          fields.parent_category_id,
          "Parent category"
        )
        const input = parent === undefined ? fields : { ...fields, parent_category_id: parent }
        return categoryService.updateCategory(req.storeId, uuid, parse(input))
      },
    })
    const rows = req.auth?.channel === "pos" ? await posCategories(data.created) : data.created
    return bulkUpdateResponse(res, data, message, rows)
  })
}

/** PATCH /categories/bulk — any category field, as in create (only what is sent changes). */
export const patchBulk = bulkCategoryUpdate((fields) => {
  const patch = parsePatchCategory(fields)
  if (!Object.keys(patch).length) throw new AppError("No fields to update", 400)
  return patch
}, "Categories Updated")

/** PATCH /categories/bulk/status — { id, is_active }. */
export const patchBulkStatus = bulkCategoryUpdate(
  (fields) => ({ is_active: requireBoolean(fields, "is_active") }),
  "Category Status Updated"
)
