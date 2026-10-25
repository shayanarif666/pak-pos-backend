import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as currencyService from "./currency.service.js"

export const get = asyncHandler(async (req, res) => {
  const data = await currencyService.getCurrency(req.storeId)
  return apiResponse(res, 200, "OK", data)
})

export const put = asyncHandler(async (req, res) => {
  const data = await currencyService.putCurrency(req.storeId, req.body)
  return apiResponse(res, 200, "Currency saved", data)
})
