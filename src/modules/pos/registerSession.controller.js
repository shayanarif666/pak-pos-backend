import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as sessionService from "./registerSession.service.js"
import { resolveStaff } from "../../shared/utils/staff.util.js"
import * as posHistory from "./posHistory.service.js"
import { parseCloseBatch, parseOpenBatch } from "./registerSession.validation.js"
import { extractBulkItems, posBulkResponse, runBulk } from "../../shared/utils/bulk.util.js"
import { bulkUpdateResponse, runBulkUpdate } from "../../shared/utils/bulkUpdate.util.js"
import { RegisterSession } from "./registerSession.model.js"

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

/**
 * Batch open / close: one batch (body already validated by the route) or, for POS offline sync,
 * several at once ({ location_id?, items: [{ staffId, ... }, ...] }) — each item validated and
 * saved on its own, in order; a location_id sent once applies to every item without its own.
 */
function batchAction(run, parse, status, message) {
  return asyncHandler(async (req, res) => {
    const actor = actorFromReq(req)
    const one = async ({ staff_ref, ...fields }) =>
      run(actor, await resolveStaff(actor.store_id, staff_ref, req.user), fields)
    if (!Array.isArray(req.body?.items)) return apiResponse(res, status, message, await one(req.body))
    const location_id = req.body.location_id ?? req.body.locationId
    const data = await runBulk(extractBulkItems(req.body), (item) =>
      one(parse({ ...(location_id == null ? {} : { location_id }), ...(item || {}) }))
    )
    return posBulkResponse(res, data, message, data.created)
  })
}

export const openBatch = batchAction(sessionService.openBatch, parseOpenBatch, 201, "Batch Open")
export const closeBatch = batchAction(sessionService.closeBatch, parseCloseBatch, 200, "Batch Closed")

/** PATCH /batches/bulk — items[] = [{ id (batch number), opening_cash?, cash_in?, cash_out?, counted_cash?, opened_at?, closed_at?, note? }]. */
export const patchBulk = asyncHandler(async (req, res) => {
  const actor = actorFromReq(req)
  const data = await runBulkUpdate(req.body, {
    model: RegisterSession,
    column: "session_number",
    label: "Batch",
    storeId: actor.store_id,
    handler: (uuid, fields) => sessionService.updateBatch(actor, uuid, fields),
  })
  return bulkUpdateResponse(res, data, "Batches Updated", data.created)
})

export const patchOne = asyncHandler(async (req, res) => {
  const data = await sessionService.updateBatch(actorFromReq(req), req.params.id, req.body || {})
  return apiResponse(res, 200, "Batch Updated", data)
})

export const remove = asyncHandler(async (req, res) => {
  const data = await sessionService.deleteBatch(actorFromReq(req), req.params.id)
  return apiResponse(res, 200, "Batch Deleted", data)
})
