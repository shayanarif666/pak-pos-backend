import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { AppError } from "../../shared/errors/AppError.js"
import { checkHealth } from "./health.service.js"

export const getHealth = asyncHandler(async (req, res) => {
  try {
    const data = await checkHealth()
    return apiResponse(res, 200, "OK", data)
  } catch {
    throw new AppError("Database unavailable", 503)
  }
})
