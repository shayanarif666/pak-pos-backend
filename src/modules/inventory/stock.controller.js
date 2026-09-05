import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as stockService from "./stock.service.js"

export const list = asyncHandler(async (req, res) => {
  const data = await stockService.listMovements(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const create = asyncHandler(async (req, res) => {
  const data = await stockService.createMovement(req.user, req.body)
  return apiResponse(res, 201, "Stock movement recorded", data)
})
