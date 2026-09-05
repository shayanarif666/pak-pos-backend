import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as stockService from "./productStock.service.js"

export const list = asyncHandler(async (req, res) => {
  const data = await stockService.listStocks(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const listLow = asyncHandler(async (req, res) => {
  const data = await stockService.listLowStocks(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const getOne = asyncHandler(async (req, res) => {
  const data = await stockService.getStock(req.user, req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const put = asyncHandler(async (req, res) => {
  const data = await stockService.putStock(
    req.user,
    req.params.productId,
    req.body
  )
  return apiResponse(res, 200, "Stock updated", data)
})
