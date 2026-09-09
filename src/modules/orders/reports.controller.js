import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as reportsService from "./reports.service.js"
import { posBreakdownReport } from "./reports.pos.service.js"

export const sales = asyncHandler(async (req, res) => {
  const data = await reportsService.salesReport(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const payments = asyncHandler(async (req, res) => {
  const data = await reportsService.paymentsReport(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const profit = asyncHandler(async (req, res) => {
  const data = await reportsService.profitReport(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const dashboard = asyncHandler(async (req, res) => {
  const data = await reportsService.dashboardReport(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const breakdown = asyncHandler(async (req, res) => {
  const data = await posBreakdownReport(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const exportOne = asyncHandler(async (req, res) => {
  const file = await reportsService.exportReport(req.user, req.query)
  res.setHeader("Content-Type", file.contentType)
  res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`)
  return res.status(200).send(file.body)
})
