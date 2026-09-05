import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as auditService from "./audit.service.js"

export const list = asyncHandler(async (req, res) => {
  const data = await auditService.listStoreAudit(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const listAdmin = asyncHandler(async (req, res) => {
  const data = await auditService.listPlatformAudit(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})
