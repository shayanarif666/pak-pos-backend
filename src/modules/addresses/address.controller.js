import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as addressService from "./address.service.js"

export const list = asyncHandler(async (req, res) => {
  const data = await addressService.listAddresses(req.user)
  return apiResponse(res, 200, "OK", data)
})

export const create = asyncHandler(async (req, res) => {
  const data = await addressService.createAddress(req.user, req.body)
  return apiResponse(res, 201, "Address saved", data)
})

export const patch = asyncHandler(async (req, res) => {
  const data = await addressService.updateAddress(req.user, req.params.id, req.body)
  return apiResponse(res, 200, "Address updated", data)
})

export const remove = asyncHandler(async (req, res) => {
  const data = await addressService.deleteAddress(req.user, req.params.id)
  return apiResponse(res, 200, "Address removed", data)
})
