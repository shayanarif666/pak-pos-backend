import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import * as licenseService from "./license.service.js"

export const validate = asyncHandler(async (req, res) => {
  const data = await licenseService.activateLicenseKey(req.body, {
    ip: req.ip,
    userAgent: req.get("user-agent"),
  })
  const message = data.device
    ? "License activated and device registered"
    : data.status === "pending"
      ? "License is pending activation"
      : "License is active"
  return res.status(200).json({ success: true, message })
})

export const listMine = asyncHandler(async (req, res) => {
  const data = await licenseService.listStoreLicenses(req.storeId)
  return apiResponse(res, 200, "OK", data)
})

export const getMine = asyncHandler(async (req, res) => {
  const data = await licenseService.getStoreLicense(req.storeId, req.params.id)
  if (req.user.role === "manager" && data.status !== "pending") {
    if (data.device?.location_id !== req.user.location_id) {
      throw new ForbiddenError("Managers can only view their location license")
    }
  }
  return apiResponse(res, 200, "OK", data)
})

export const getByLocation = asyncHandler(async (req, res) => {
  const data = await licenseService.getLicenseByLocation(
    req.storeId,
    req.params.locationId,
    req.user
  )
  return apiResponse(res, 200, "OK", data)
})

export const me = asyncHandler(async (req, res) => {
  const data = await licenseService.getCurrentLicense(req.storeId)
  return apiResponse(res, 200, "OK", data)
})

export const revoke = asyncHandler(async (req, res) => {
  const data = await licenseService.revokeLicense(
    req.params.id,
    req.body.revoked_reason
  )
  return apiResponse(res, 200, "License revoked", data)
})

export const renew = asyncHandler(async (req, res) => {
  const data = await licenseService.renewLicense(req.params.id)
  return apiResponse(res, 200, "License renewed", data)
})
