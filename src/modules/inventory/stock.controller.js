import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { bulkStatus, extractBulkItems, runBulk } from "../../shared/utils/bulk.util.js"
import { parseCreateMovement } from "./stock.validation.js"
import * as stockService from "./stock.service.js"

export const list = asyncHandler(async (req, res) => {
  const data = await stockService.listMovements(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const create = asyncHandler(async (req, res) => {
  const data = await stockService.createMovement(movementActor(req), req.body)
  return apiResponse(res, 201, "Stock movement recorded", data)
})

function movementActor(req) {
  return {
    ...req.user.get({ plain: true }),
    store_id: req.auth?.store_id || req.user.store_id,
    location_id: req.auth?.location_id || req.user.location_id,
  }
}

export const createBulk = asyncHandler(async (req, res) => {
  const actor = movementActor(req)
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    return stockService.createMovement(actor, parseCreateMovement(item))
  })
  return apiResponse(res, bulkStatus(data), "Bulk stock movements processed", data)
})
