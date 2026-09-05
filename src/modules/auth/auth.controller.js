import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as authService from "./auth.service.js"

function requestMeta(req) {
  return {
    ip: req.ip,
    userAgent: req.get("user-agent"),
  }
}

export const login = asyncHandler(async (req, res) => {
  const data = await authService.login(req.body, requestMeta(req))
  return apiResponse(res, 200, "Logged in", data)
})

export const refresh = asyncHandler(async (req, res) => {
  const data = await authService.refreshSession(req.body.refresh_token)
  return apiResponse(res, 200, "Token refreshed", data)
})

export const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.user, requestMeta(req))
  return apiResponse(res, 200, "Logged out", null)
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
