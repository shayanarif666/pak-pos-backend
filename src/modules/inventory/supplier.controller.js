import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { getStoreForManager } from "../stores/store.service.js"
import { bulkStatus, extractBulkItems, posBulkResponse, runBulk } from "../../shared/utils/bulk.util.js"
import { parseCreateSupplier, parsePatchSupplier } from "./supplier.validation.js"
import { Supplier } from "./supplier.model.js"
import { bulkUpdateResponse, runBulkUpdate } from "../../shared/utils/bulkUpdate.util.js"
import * as supplierService from "./supplier.service.js"
import { posSupplier } from "../pos/posResponses.js"
import * as posHistory from "../pos/posHistory.service.js"

export const list = asyncHandler(async (req, res) => {
  if (req.auth?.channel === "pos") return posHistory.sendPage(res, await posHistory.suppliers(req))
  const data = await supplierService.listSuppliers(req.storeId, req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const getOne = asyncHandler(async (req, res) => {
  const data = await supplierService.getSupplierView(req.storeId, req.params.id, req.user)
  return apiResponse(res, 200, "OK", data)
})

export const create = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const data = await supplierService.createSupplier(store, req.body, req.user)
  if (req.auth?.channel === "pos") {
    return apiResponse(res, 201, "Supplier Created", posSupplier(data))
  }
  return apiResponse(res, 201, "Supplier created", data)
})

export const createBulk = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    return supplierService.createSupplier(store, parseCreateSupplier(item), req.user)
  })
  if (req.auth?.channel === "pos") {
    return posBulkResponse(res, data, "Supplier Created", data.created.map(posSupplier))
  }
  return apiResponse(res, bulkStatus(data), "Bulk suppliers processed", data)
})

export const patch = asyncHandler(async (req, res) => {
  const data = await supplierService.updateSupplier(
    req.storeId,
    req.params.id,
    req.body,
    req.user
  )
  return apiResponse(res, 200, "Supplier updated", data)
})

export const remove = asyncHandler(async (req, res) => {
  const data = await supplierService.deactivateSupplier(req.storeId, req.params.id, req.user)
  return apiResponse(res, 200, "Supplier deactivated", data)
})

/**
 * PATCH /suppliers/bulk (POS offline sync) — items[] = [{ id (supplier number), ...fields }]:
 * name, phone, email, address, payment_terms, is_active, location_scope / location_ids.
 */
export const patchBulk = asyncHandler(async (req, res) => {
  const data = await runBulkUpdate(req.body, {
    model: Supplier,
    column: "supplier_number",
    label: "Supplier",
    storeId: req.storeId,
    handler: (uuid, fields) => supplierService.updateSupplier(req.storeId, uuid, parsePatchSupplier(fields), req.user),
  })
  const rows = req.auth?.channel === "pos" ? data.created.map(posSupplier) : data.created
  return bulkUpdateResponse(res, data, "Suppliers Updated", rows)
})
