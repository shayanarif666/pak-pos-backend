import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { resolveStaff, staffRefFrom } from "../../shared/utils/staff.util.js"
import * as staffSessionService from "./staffSession.service.js"
import * as posHistory from "./posHistory.service.js"

// The POS sends the staff member as id (their user number); staff_id / staffId also work.
const STAFF_KEYS = ["staff_id", "staffId", "id"]

function actorFromReq(req) {
  return {
    id: req.user.id,
    role: req.user.role,
    store_id: req.auth?.store_id || req.user.store_id,
    location_id: req.auth?.location_id || req.user.location_id,
    device_id: req.auth?.device_id || null,
  }
}

function clockedAt(body) {
  const raw = body?.clocked_at
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

/** User session history: ?staffId, status (clock_in | clock_out), from, to, location_id. */
export const list = asyncHandler(async (req, res) => {
  return posHistory.sendPage(res, await posHistory.staffSessions(req))
})

export const clockIn = asyncHandler(async (req, res) => {
  const actor = actorFromReq(req)
  const staff = await resolveStaff(actor.store_id, staffRefFrom(req.body, STAFF_KEYS), req.user)
  const data = await staffSessionService.clockIn(actor, staff, { clocked_at: clockedAt(req.body) })
  return apiResponse(res, 201, "Clock In Session", data)
})

export const clockOut = asyncHandler(async (req, res) => {
  const actor = actorFromReq(req)
  const staff = await resolveStaff(actor.store_id, staffRefFrom(req.body, STAFF_KEYS), req.user)
  const data = await staffSessionService.clockOut(actor, staff, { clocked_at: clockedAt(req.body) })
  return apiResponse(res, 200, "Clock Out Session", data)
})
