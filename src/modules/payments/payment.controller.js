import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as paymentService from "./payment.service.js"

export const confirm = asyncHandler(async (req, res) => {
  const data = await paymentService.confirmPayment(req.storeId, req.params.id)
  return apiResponse(res, 200, "Payment confirmed", data)
})
