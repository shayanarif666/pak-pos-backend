import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as taxRateService from "./taxRate.service.js"

export const list = asyncHandler(async (req, res) => {
  const data = await taxRateService.getTaxRates(req.storeId)
  return apiResponse(res, 200, "OK", data)
})

export const put = asyncHandler(async (req, res) => {
  const data = await taxRateService.putTaxRates(req.storeId, req.body)
  return apiResponse(res, 200, "Tax rates saved", data)
})
