import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { bulkStatus, extractBulkItems, posBulkResponse, runBulk } from "../../shared/utils/bulk.util.js"
import { bulkUpdateResponse, requireBoolean, runBulkUpdate } from "../../shared/utils/bulkUpdate.util.js"
import { getStoreForManager } from "../stores/store.service.js"
import { StoreTax } from "./storeTax.model.js"
import { parseCreateTax, parsePatchTax } from "./tax.validation.js"
import * as taxService from "./tax.service.js"

export const list = asyncHandler(async (req, res) => {
  return apiResponse(res, 200, "OK", await taxService.listTaxes(req.storeId, req.query))
})

export const getOne = asyncHandler(async (req, res) => {
  return apiResponse(res, 200, "OK", await taxService.getTaxView(req.storeId, req.params.id))
})

export const create = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  return apiResponse(res, 201, "Tax Created", await taxService.createTax(store, parseCreateTax(req.body), req.user))
})

/** POST /taxes/bulk — { items: [ ...taxes ] }; a tax that fails is listed in failed[]. */
export const createBulk = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const data = await runBulk(extractBulkItems(req.body), (item) => taxService.createTax(store, parseCreateTax(item), req.user))
  if (req.auth?.channel === "pos") return posBulkResponse(res, data, "Taxes Created", data.created)
  return apiResponse(res, bulkStatus(data), "Taxes Created", data)
})

export const patch = asyncHandler(async (req, res) => {
  return apiResponse(res, 200, "Tax Updated", await taxService.updateTax(req.storeId, req.params.id, parsePatchTax(req.body)))
})

/** PATCH /taxes/bulk — items[] = [{ id (tax number or UUID), ...fields }]. */
function bulkTaxUpdate(parse, message) {
  return asyncHandler(async (req, res) => {
    const data = await runBulkUpdate(req.body, {
      model: StoreTax,
      column: "tax_number",
      label: "Tax",
      storeId: req.storeId,
      handler: (uuid, fields) => taxService.updateTax(req.storeId, uuid, parse(fields)),
    })
    return bulkUpdateResponse(res, data, message, data.created)
  })
}

export const patchBulk = bulkTaxUpdate(parsePatchTax, "Taxes Updated")

/** PATCH /taxes/bulk/status — { id, is_active }. */
export const patchBulkStatus = bulkTaxUpdate((fields) => ({ is_active: requireBoolean(fields, "is_active") }), "Tax Status Updated")

export const remove = asyncHandler(async (req, res) => {
  return apiResponse(res, 200, "Tax Deleted", await taxService.deleteTax(req.storeId, req.params.id))
})
