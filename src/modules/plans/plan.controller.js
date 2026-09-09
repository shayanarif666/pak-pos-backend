import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as planService from "./plan.service.js"

export const list = asyncHandler(async (req, res) => {
  const data = await planService.listPlans()
  return apiResponse(res, 200, "OK", data)
})

export const getOne = asyncHandler(async (req, res) => {
  const data = await planService.getPlanView(req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const create = asyncHandler(async (req, res) => {
  const { plan, created } = await planService.upsertPlan(req.user, req.body)
  return apiResponse(
    res,
    created ? 201 : 200,
    created ? "Plan created" : "Plan updated",
    plan
  )
})

export const patch = asyncHandler(async (req, res) => {
  const data = await planService.updatePlan(req.user, req.params.id, req.body)
  return apiResponse(res, 200, "Plan updated", data)
})

export const remove = asyncHandler(async (req, res) => {
  const data = await planService.deletePlan(req.user, req.params.id)
  return apiResponse(res, 200, "Plan deleted", data)
})
