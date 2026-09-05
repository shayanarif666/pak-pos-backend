import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as backupService from "./backup.service.js"

export const list = asyncHandler(async (req, res) => {
  const data = await backupService.listBackups(req.storeId)
  return apiResponse(res, 200, "OK", data)
})

export const create = asyncHandler(async (req, res) => {
  const data = await backupService.createBackup(req.storeId, req.body, req.user)
  return apiResponse(res, 201, "Backup created", data)
})

export const restore = asyncHandler(async (req, res) => {
  const data = await backupService.restoreBackup(req.params.id, req.user)
  return apiResponse(res, 200, "Backup restored", data)
})
