import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { getStoreForManager } from "../stores/store.service.js"
import * as couponService from "./coupon.service.js"

export const list = asyncHandler(async (req, res) => {
  const data = await couponService.listCoupons(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const getOne = asyncHandler(async (req, res) => {
  const data = await couponService.getCouponView(req.user, req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const create = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const data = await couponService.createCoupon(store, req.body, req.user)
  return apiResponse(res, 201, "Coupon created", data)
})

export const patch = asyncHandler(async (req, res) => {
  const data = await couponService.updateCoupon(req.user, req.params.id, req.body)
  return apiResponse(res, 200, "Coupon updated", data)
})

export const validateCoupon = asyncHandler(async (req, res) => {
  const data = await couponService.previewCoupon(req.user, req.body)
  return apiResponse(res, 200, data.valid ? "Coupon valid" : "Coupon not valid", data)
})

export const listRedemptions = asyncHandler(async (req, res) => {
  const data = await couponService.listRedemptions(req.user, req.params.id)
  return apiResponse(res, 200, "OK", data)
})
