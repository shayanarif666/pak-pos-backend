import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as reviewService from "./review.service.js"

export const create = asyncHandler(async (req, res) => {
  const data = await reviewService.createReview(req.user, req.body)
  return apiResponse(res, 201, "Review submitted", data)
})

export const list = asyncHandler(async (req, res) => {
  const data = await reviewService.listReviews(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const moderate = asyncHandler(async (req, res) => {
  const data = await reviewService.moderateReview(req.user, req.params.id, req.body)
  return apiResponse(res, 200, "Review updated", data)
})

export const listPublic = asyncHandler(async (req, res) => {
  const data = await reviewService.listPublicReviews(req.params.slug, req.params.id)
  return apiResponse(res, 200, "OK", data)
})
