import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as auditService from "./audit.service.js"

function actorFromReq(req) {
  const user = req.user
  return {
    id: user.id,
    role: user.role,
    store_id: req.auth?.store_id || user.store_id,
    location_id: req.auth?.location_id || user.location_id || null,
  }
}

export const list = asyncHandler(async (req, res) => {
  const data = await auditService.listStoreAudit(actorFromReq(req), req.query)
  return apiResponse(res, 200, "OK", data)
})

export const listAdmin = asyncHandler(async (req, res) => {
  const data = await auditService.listPlatformAudit(actorFromReq(req), req.query)
  return apiResponse(res, 200, "OK", data)
})
