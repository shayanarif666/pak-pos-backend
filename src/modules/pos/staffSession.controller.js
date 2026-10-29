import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { resolveStaff, staffRefFrom } from "../../shared/utils/staff.util.js"
import * as staffSessionService from "./staffSession.service.js"
import * as posHistory from "./posHistory.service.js"
import { StaffSession } from "./staffSession.model.js"
import { bulkUpdateResponse, runBulkUpdate } from "../../shared/utils/bulkUpdate.util.js"
import { extractBulkItems, posBulkResponse, runBulk } from "../../shared/utils/bulk.util.js"

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

/**
 * Clock in / out: one staff member ({ staffId, clocked_at? }) or, for POS offline sync, many at
 * once ({ items: [{ staffId, clocked_at? }, ...] }) — each item saved on its own, in order.
 */
function clockAction(run, status, message) {
  return asyncHandler(async (req, res) => {
    const actor = actorFromReq(req)
    const one = async (body) => {
      const staff = await resolveStaff(actor.store_id, staffRefFrom(body, STAFF_KEYS), req.user)
      return run(actor, staff, { clocked_at: clockedAt(body) })
    }
    if (!Array.isArray(req.body?.items)) return apiResponse(res, status, message, await one(req.body || {}))
    const data = await runBulk(extractBulkItems(req.body), (item) => one(item || {}))
    return posBulkResponse(res, data, message, data.created)
  })
}

export const clockIn = clockAction(staffSessionService.clockIn, 201, "Clock In Session")
export const clockOut = clockAction(staffSessionService.clockOut, 200, "Clock Out Session")

/** PATCH /staff-sessions/bulk — items[] = [{ id (session number), clock_in_at?, clock_out_at? }]. */
export const patchBulk = asyncHandler(async (req, res) => {
  const actor = actorFromReq(req)
  const data = await runBulkUpdate(req.body, {
    model: StaffSession,
    column: "session_number",
    label: "Staff session",
    storeId: actor.store_id,
    handler: (uuid, fields) => staffSessionService.updateStaffSession(actor, uuid, fields),
  })
  return bulkUpdateResponse(res, data, "Staff Sessions Updated", data.created)
})
