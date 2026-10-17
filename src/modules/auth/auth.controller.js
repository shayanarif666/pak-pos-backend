import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as authService from "./auth.service.js"

function requestMeta(req) {
  return {
    ip: req.ip,
    userAgent: req.get("user-agent"),
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// The POS till identifies itself with a header, so the login body stays credentials + channel.
// X-Device-Uid: the till's stable hardware id (sent on license activation); X-Device-Id: its
// pos_devices row id. Both optional; they pick the right user when a PIN exists at several
// locations and tag the session with the till.
function loginDeviceHint(req) {
  const deviceUid = String(req.get("x-device-uid") || "").trim()
  const deviceId = String(req.get("x-device-id") || "").trim()
  return {
    device_uid: deviceUid || null,
    device_id: UUID_RE.test(deviceId) ? deviceId : null,
  }
}

export const login = asyncHandler(async (req, res) => {
  const data = await authService.login({ ...req.body, ...loginDeviceHint(req) }, requestMeta(req))
  return apiResponse(res, 200, "Logged in", data)
})

export const refresh = asyncHandler(async (req, res) => {
  const data = await authService.refreshSession(req.body.refresh_token)
  return apiResponse(res, 200, "Token refreshed", data)
})

export const logout = asyncHandler(async (req, res) => {
  const data = await authService.logout(req.user, { ...requestMeta(req), sid: req.auth?.sid })
  return apiResponse(res, 200, "Logged out", data)
})

export const me = asyncHandler(async (req, res) => {
  const data = await authService.getMe(req.user)
  return apiResponse(res, 200, "OK", data)
})

export const patchMe = asyncHandler(async (req, res) => {
  const data = await authService.patchMe(req.user, req.body)
  return apiResponse(res, 200, "Profile updated", data)
})

export const registerCustomer = asyncHandler(async (req, res) => {
  const data = await authService.registerCustomer(req.body)
  return apiResponse(res, 201, "Customer registered", data)
})

export const forgotPassword = asyncHandler(async (req, res) => {
  const data = await authService.forgotPassword(req.body)
  return apiResponse(res, 200, data.message, {
    reset_token: data.reset_token || null,
  })
})

export const resetPassword = asyncHandler(async (req, res) => {
  const data = await authService.resetPassword(req.body)
  return apiResponse(res, 200, "Password reset", data)
})

export const verifyEmail = asyncHandler(async (req, res) => {
  const data = await authService.verifyEmail(req.body)
  return apiResponse(res, 200, "Email verified", data)
})
