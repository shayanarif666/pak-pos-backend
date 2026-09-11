import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { bulkStatus, extractBulkItems, runBulk } from "../../shared/utils/bulk.util.js"
import { parseCreateStaff } from "./staff.validation.js"
import * as staffService from "./staff.service.js"

export const list = asyncHandler(async (req, res) => {
  const data = await staffService.listStaff(req.user)
  return apiResponse(res, 200, "OK", data)
})

export const getOne = asyncHandler(async (req, res) => {
  const data = await staffService.getStaff(req.user, req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const create = asyncHandler(async (req, res) => {
  const actor = {
    ...req.user.get({ plain: true }),
    store_id: req.auth?.store_id || req.user.store_id,
    location_id: req.auth?.location_id || req.user.location_id,
  }
  const data = await staffService.createStaff(actor, req.body)
  return apiResponse(res, 201, "Staff created", data)
})

export const createBulk = asyncHandler(async (req, res) => {
  const actor = {
    ...req.user.get({ plain: true }),
    store_id: req.auth?.store_id || req.user.store_id,
    location_id: req.auth?.location_id || req.user.location_id,
  }
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    return staffService.createStaff(actor, parseCreateStaff(item))
  })
  return apiResponse(res, bulkStatus(data), "Bulk staff processed", data)
})

export const patch = asyncHandler(async (req, res) => {
  const data = await staffService.patchStaff(req.user, req.params.id, req.body)
  return apiResponse(res, 200, "Staff updated", data)
})

export const sales = asyncHandler(async (req, res) => {
  const data = await staffService.getStaffSales(req.user, req.params.id, req.query)
  return apiResponse(res, 200, "OK", data)
})
