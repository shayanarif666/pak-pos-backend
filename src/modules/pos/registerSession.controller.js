import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as sessionService from "./registerSession.service.js"
import { resolveStaff } from "../../shared/utils/staff.util.js"
import * as posHistory from "./posHistory.service.js"

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
    device_id: req.auth?.device_id || null,
  }
}

export const list = asyncHandler(async (req, res) => {
  if (req.auth?.channel === "pos") return posHistory.sendPage(res, await posHistory.batches(req))
  const data = await sessionService.listSessions(actorFromReq(req), req.query)
  return apiResponse(res, 200, "OK", data)
})

export const current = asyncHandler(async (req, res) => {
  if (req.auth?.channel === "pos") return apiResponse(res, 200, "OK", await posHistory.currentBatch(req))
  const data = await sessionService.getCurrentSession(actorFromReq(req), req.query)
  return apiResponse(res, 200, "OK", data)
})

export const getOne = asyncHandler(async (req, res) => {
  const data = await sessionService.getSessionView(actorFromReq(req), req.params.id)
  return apiResponse(res, 200, "OK", data)
})

async function batchStaff(req, actor) {
  return resolveStaff(actor.store_id, req.body.staff_ref, req.user)
}

export const openBatch = asyncHandler(async (req, res) => {
  const actor = actorFromReq(req)
  const { staff_ref: _ref, ...fields } = req.body
  const data = await sessionService.openBatch(actor, await batchStaff(req, actor), fields)
  return apiResponse(res, 201, "Batch Open", data)
})

export const closeBatch = asyncHandler(async (req, res) => {
  const actor = actorFromReq(req)
  const { staff_ref: _ref, ...fields } = req.body
  const data = await sessionService.closeBatch(actor, await batchStaff(req, actor), fields)
  return apiResponse(res, 200, "Batch Closed", data)
})
