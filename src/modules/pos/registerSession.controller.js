import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as sessionService from "./registerSession.service.js"

function actorFromReq(req) {
  const user = req.user
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    store_id: req.auth?.store_id || user.store_id,
    location_id: req.auth?.location_id || user.location_id,
    store_id_int: user.store_id_int,
    location_id_int: user.location_id_int,
  }
}

export const list = asyncHandler(async (req, res) => {
  const data = await sessionService.listSessions(actorFromReq(req), req.query)
  return apiResponse(res, 200, "OK", data)
})

export const current = asyncHandler(async (req, res) => {
  const data = await sessionService.getCurrentSession(actorFromReq(req), req.query)
  return apiResponse(res, 200, "OK", data)
})

export const getOne = asyncHandler(async (req, res) => {
  const data = await sessionService.getSessionView(actorFromReq(req), req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const clockIn = asyncHandler(async (req, res) => {
  const data = await sessionService.clockIn(actorFromReq(req), req.body)
  return apiResponse(res, 201, "Clocked in", data)
})

export const clockOut = asyncHandler(async (req, res) => {
  const data = await sessionService.clockOut(actorFromReq(req), req.params.id, req.body)
  return apiResponse(res, 200, "Clocked out", data)
})
