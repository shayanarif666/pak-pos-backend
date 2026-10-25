import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as taxRateService from "./taxRate.service.js"
import { posTaxRates } from "../pos/posHistory.service.js"

export const list = asyncHandler(async (req, res) => {
  const data = await taxRateService.getTaxRates(req.storeId)
  if (req.auth?.channel === "pos") return apiResponse(res, 200, "OK", posTaxRates(data))
  return apiResponse(res, 200, "OK", data)
})

export const put = asyncHandler(async (req, res) => {
  const data = await taxRateService.putTaxRates(req.storeId, req.body)
  return apiResponse(res, 200, "Tax rates saved", data)
})
