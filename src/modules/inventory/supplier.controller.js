import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { getStoreForManager } from "../stores/store.service.js"
import { bulkStatus, extractBulkItems, runBulk } from "../../shared/utils/bulk.util.js"
import { parseCreateSupplier } from "./supplier.validation.js"
import * as supplierService from "./supplier.service.js"

export const list = asyncHandler(async (req, res) => {
  const data = await supplierService.listSuppliers(req.storeId)
  return apiResponse(res, 200, "OK", data)
})

export const getOne = asyncHandler(async (req, res) => {
  const data = await supplierService.getSupplierView(req.storeId, req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const create = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const data = await supplierService.createSupplier(store, req.body)
  return apiResponse(res, 201, "Supplier created", data)
})

export const createBulk = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    return supplierService.createSupplier(store, parseCreateSupplier(item))
  })
  return apiResponse(res, bulkStatus(data), "Bulk suppliers processed", data)
})

export const patch = asyncHandler(async (req, res) => {
  const data = await supplierService.updateSupplier(
    req.storeId,
    req.params.id,
    req.body
  )
  return apiResponse(res, 200, "Supplier updated", data)
})

export const remove = asyncHandler(async (req, res) => {
  const data = await supplierService.deactivateSupplier(req.storeId, req.params.id)
  return apiResponse(res, 200, "Supplier deactivated", data)
})

export const listLedger = asyncHandler(async (req, res) => {
  const data = await supplierService.listLedger(req.storeId, req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const addLedger = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const data = await supplierService.addLedgerEntry(
    store,
    req.params.id,
    req.body,
    req.user
  )
  return apiResponse(res, 201, "Ledger entry recorded", data)
})
