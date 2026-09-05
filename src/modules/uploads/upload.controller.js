import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { AppError } from "../../shared/errors/AppError.js"
import {
  publicUpload,
  uploadImageBuffer,
} from "../../shared/utils/cloudinary.util.js"
import { parseUploadQuery } from "./upload.validation.js"

export const create = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError("file is required", 400)
  const { kind } = parseUploadQuery(req.query)
  const storeId = req.storeId || req.user?.store_id || "platform"
  const result = await uploadImageBuffer(req.file.buffer, {
    folder: `pak-pos/${storeId}/${kind}`,
    filename: req.file.originalname,
  })
  return apiResponse(res, 201, "File uploaded", publicUpload(result))
})
