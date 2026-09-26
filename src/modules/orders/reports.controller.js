import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as reportsService from "./reports.service.js"
import { posBreakdownReport } from "./reports.pos.service.js"

function actorFromReq(req) {
  const user = req.user
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    store_id: req.auth?.store_id || user.store_id,
    store_id_int: user.store_id_int ?? req.auth?.store_number ?? null,
    location_id: req.auth?.location_id || user.location_id || null,
    location_id_int: user.location_id_int ?? req.auth?.location_number ?? null,
  }
}

export const sales = asyncHandler(async (req, res) => {
  const data = await reportsService.salesReport(actorFromReq(req), req.query)
  return apiResponse(res, 200, "OK", data)
})

export const payments = asyncHandler(async (req, res) => {
  const data = await reportsService.paymentsReport(actorFromReq(req), req.query)
  return apiResponse(res, 200, "OK", data)
})

export const profit = asyncHandler(async (req, res) => {
  const data = await reportsService.profitReport(actorFromReq(req), req.query)
  return apiResponse(res, 200, "OK", data)
})

export const dashboard = asyncHandler(async (req, res) => {
  const data = await reportsService.dashboardReport(actorFromReq(req), req.query)
  return apiResponse(res, 200, "OK", data)
})

export const breakdown = asyncHandler(async (req, res) => {
  const data = await posBreakdownReport(actorFromReq(req), req.query)
  return apiResponse(res, 200, "OK", data)
})

export const exportOne = asyncHandler(async (req, res) => {
  const file = await reportsService.exportReport(actorFromReq(req), req.query)
  res.setHeader("Content-Type", file.contentType)
  res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`)
  return res.status(200).send(file.body)
})
