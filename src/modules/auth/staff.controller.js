import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
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
  const data = await staffService.createStaff(req.user, req.body)
  return apiResponse(res, 201, "Staff created", data)
})

export const patch = asyncHandler(async (req, res) => {
  const data = await staffService.patchStaff(req.user, req.params.id, req.body)
  return apiResponse(res, 200, "Staff updated", data)
})

export const sales = asyncHandler(async (req, res) => {
  const data = await staffService.getStaffSales(req.user, req.params.id, req.query)
  return apiResponse(res, 200, "OK", data)
})
