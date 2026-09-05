import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as transferService from "./transfer.service.js"

export const list = asyncHandler(async (req, res) => {
  const data = await transferService.listTransfers(req.storeId)
  return apiResponse(res, 200, "OK", data)
})

export const create = asyncHandler(async (req, res) => {
  const data = await transferService.createTransfer(
    req.storeId,
    req.body,
    req.user
  )
  return apiResponse(res, 201, "Transfer created", data)
})

export const complete = asyncHandler(async (req, res) => {
  const data = await transferService.completeTransfer(
    req.storeId,
    req.params.id,
    req.user
  )
  return apiResponse(res, 200, "Transfer completed", data)
})

export const cancel = asyncHandler(async (req, res) => {
  const data = await transferService.cancelTransfer(req.storeId, req.params.id)
  return apiResponse(res, 200, "Transfer cancelled", data)
})
