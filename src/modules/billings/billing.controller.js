import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as billingService from "./billing.service.js"
import { Plan } from "../plans/plan.model.js"
import { posShape } from "../../shared/utils/posShape.js"

export const listAdmin = asyncHandler(async (req, res) => {
  const storeId = req.query.storeId || req.query.store_id
  const data = await billingService.listAllBillings(storeId || undefined)
  return apiResponse(res, 200, "OK", data)
})

export const createAdmin = asyncHandler(async (req, res) => {
  const data = await billingService.createBilling(req.body, {
    createdBy: req.user.id,
  })
  return apiResponse(res, 201, "Billing recorded", data)
})

export const patchAdmin = asyncHandler(async (req, res) => {
  const data = await billingService.updateBilling(req.params.id, req.body)
  return apiResponse(res, 200, "Billing updated", data)
})

export const listMine = asyncHandler(async (req, res) => {
  const data = await billingService.listStoreBillings(req.storeId)
  if (!posShape(req)) return apiResponse(res, 200, "OK", data)
  // The Billings table: { id (billing number, the oldest is 1), plan { name, code }, period_start, period_end, method, amount, currency, status, paid_at, note }.
  const plans = new Map((await Plan.findAll({ where: { id: [...new Set(data.map((row) => row.plan_id))] }, attributes: ["id", "name", "code", "type"] })).map((plan) => [plan.id, plan]))
  const numbered = [...data].reverse().map((row, index) => ({ row, number: index + 1 })).reverse()
  return apiResponse(res, 200, "OK", numbered.map(({ row, number }) => {
    const plan = plans.get(row.plan_id)
    return {
      id: number,
      plan: plan ? { name: plan.name, code: plan.code, type: plan.type || null } : null,
      period_start: row.period_start,
      period_end: row.period_end,
      method: row.method_note || null,
      amount: Number(row.amount),
      currency: row.currency,
      status: row.status,
      paid_at: row.paid_at,
      note: row.note || null,
    }
  }))
})
