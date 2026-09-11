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
  const actor = {
    ...req.user.get({ plain: true }),
    store_id: req.auth?.store_id || req.user.store_id,
    location_id: req.auth?.location_id || req.user.location_id,
    store_id_int: req.user.store_id_int,
  }
  const data = await stockService.putStock(
    actor,
    req.params.productId,
    req.body
  )
  return apiResponse(res, 200, "Stock updated", data)
})
