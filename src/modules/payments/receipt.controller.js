import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as receiptService from "./receipt.service.js"
import { posReceipt } from "../pos/posResponses.js"

export const getOne = asyncHandler(async (req, res) => {
  const data = await receiptService.getReceipt(req.user, req.params.id)
  return apiResponse(res, 200, "OK", data)
})

// POS: { order_id } -> that order's receipt in the POS shape.
export const generate = asyncHandler(async (req, res) => {
  const actor = { store_id: req.auth?.store_id || req.user.store_id }
  const receipt = await receiptService.getOrderSaleReceipt(actor, req.body?.order_id ?? req.body?.orderId)
  return apiResponse(res, 200, "Receipt Generated Successfully", await posReceipt(receipt))
})
