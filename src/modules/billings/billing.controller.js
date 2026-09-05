import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as billingService from "./billing.service.js"

export const listAdmin = asyncHandler(async (req, res) => {
  const storeId = req.query.storeId || req.query.store_id
  const data = await billingService.listAllBillings(storeId || undefined)
  return apiResponse(res, 200, "OK", data)
})

export const createAdmin = asyncHandler(async (req, res) => {
  const data = await billingService.createBilling(req.body, {
    createdBy: req.user.id,
  })
  return apiResponse(res, 201, "Billing recorded", data)
})

export const patchAdmin = asyncHandler(async (req, res) => {
  const data = await billingService.updateBilling(req.params.id, req.body)
  return apiResponse(res, 200, "Billing updated", data)
})

export const listMine = asyncHandler(async (req, res) => {
  const data = await billingService.listStoreBillings(req.storeId)
  return apiResponse(res, 200, "OK", data)
})
