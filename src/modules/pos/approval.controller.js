import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as approvalService from "./approval.service.js"

export const create = asyncHandler(async (req, res) => {
  const data = await approvalService.createRequest(req.user, req.body)
  return apiResponse(res, 201, "Approval requested", data)
})

export const list = asyncHandler(async (req, res) => {
  const data = await approvalService.listRequests(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const review = asyncHandler(async (req, res) => {
  const data = await approvalService.reviewRequest(
    req.user,
    req.params.id,
    req.body
  )
  return apiResponse(res, 200, "Approval updated", data)
})

export const override = asyncHandler(async (req, res) => {
  const data = await approvalService.pinOverride(req.user, req.body)
  return apiResponse(res, 200, "PIN override recorded", data)
})
