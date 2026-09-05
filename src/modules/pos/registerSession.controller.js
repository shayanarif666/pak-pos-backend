import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as sessionService from "./registerSession.service.js"

export const list = asyncHandler(async (req, res) => {
  const data = await sessionService.listSessions(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const current = asyncHandler(async (req, res) => {
  const data = await sessionService.getCurrentSession(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const getOne = asyncHandler(async (req, res) => {
  const data = await sessionService.getSessionView(req.user, req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const clockIn = asyncHandler(async (req, res) => {
  const data = await sessionService.clockIn(req.user, req.body)
  return apiResponse(res, 201, "Clocked in", data)
})

export const clockOut = asyncHandler(async (req, res) => {
  const data = await sessionService.clockOut(req.user, req.params.id, req.body)
  return apiResponse(res, 200, "Clocked out", data)
})
