import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as deviceService from "./posDevice.service.js"

export const register = asyncHandler(async (req, res) => {
  const data = await deviceService.registerDevice(req.body, req.user)
  return apiResponse(res, 201, "Device registered", data)
})

export const list = asyncHandler(async (req, res) => {
  const data = await deviceService.listDevices(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const heartbeat = asyncHandler(async (req, res) => {
  const data = await deviceService.heartbeat(req.user, req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const patch = asyncHandler(async (req, res) => {
  const data = await deviceService.patchDevice(req.user, req.params.id, req.body)
  return apiResponse(res, 200, "Device updated", data)
})
