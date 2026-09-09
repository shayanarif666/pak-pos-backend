import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as stockService from "./stock.service.js"

export const list = asyncHandler(async (req, res) => {
  const data = await stockService.listMovements(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const create = asyncHandler(async (req, res) => {
  const actor = {
    ...req.user.get({ plain: true }),
    store_id: req.auth?.store_id || req.user.store_id,
    location_id: req.auth?.location_id || req.user.location_id,
  }
  const data = await stockService.createMovement(actor, req.body)
  return apiResponse(res, 201, "Stock movement recorded", data)
})
