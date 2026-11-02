import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { bulkStatus, extractBulkItems, posBulkResponse, runBulk } from "../../shared/utils/bulk.util.js"
import { bulkUpdateResponse, requireBoolean, runBulkUpdate } from "../../shared/utils/bulkUpdate.util.js"
import { getStoreForManager } from "../stores/store.service.js"
import { PaymentSurcharge } from "./paymentSurcharge.model.js"
import * as service from "./surcharge.service.js"

export const list = asyncHandler(async (req, res) => {
  return apiResponse(res, 200, "OK", await service.listSurcharges(req.storeId))
})

export const getOne = asyncHandler(async (req, res) => {
  return apiResponse(res, 200, "OK", await service.getSurchargeView(req.storeId, req.params.id))
})

export const create = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  return apiResponse(res, 201, "Surcharge Created", await service.createSurcharge(store, service.parseCreateSurcharge(req.body), req.user))
})

/** POST /payment-surcharges/bulk — { items: [{ method, charges, type, is_active }] }. */
export const createBulk = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const data = await runBulk(extractBulkItems(req.body), (item) =>
    service.createSurcharge(store, service.parseCreateSurcharge(item), req.user)
  )
  if (req.auth?.channel === "pos") return posBulkResponse(res, data, "Surcharges Created", data.created)
  return apiResponse(res, bulkStatus(data), "Surcharges Created", data)
})

export const patch = asyncHandler(async (req, res) => {
  return apiResponse(res, 200, "Surcharge Updated", await service.updateSurcharge(req.storeId, req.params.id, service.parsePatchSurcharge(req.body)))
})

/** PATCH bulk — items[] = [{ id (surcharge number or UUID), ...fields }]. */
function bulkUpdate(parse, message) {
  return asyncHandler(async (req, res) => {
    const data = await runBulkUpdate(req.body, {
      model: PaymentSurcharge,
      column: "surcharge_number",
      label: "Surcharge",
      storeId: req.storeId,
      handler: (uuid, fields) => service.updateSurcharge(req.storeId, uuid, parse(fields)),
    })
    return bulkUpdateResponse(res, data, message, data.created)
  })
}

export const patchBulk = bulkUpdate(service.parsePatchSurcharge, "Surcharges Updated")
export const patchBulkStatus = bulkUpdate((fields) => ({ is_active: requireBoolean(fields, "is_active") }), "Surcharge Status Updated")

export const remove = asyncHandler(async (req, res) => {
  return apiResponse(res, 200, "Surcharge Deleted", await service.deleteSurcharge(req.storeId, req.params.id))
})
