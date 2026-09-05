import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as receiptService from "./receipt.service.js"

export const getOne = asyncHandler(async (req, res) => {
  const data = await receiptService.getReceipt(req.user, req.params.id)
  return apiResponse(res, 200, "OK", data)
})
