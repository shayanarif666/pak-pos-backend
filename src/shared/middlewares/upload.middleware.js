import multer from "multer"
import { AppError } from "../errors/AppError.js"
import { publicUpload, uploadImageBuffer } from "../utils/cloudinary.util.js"

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
])

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!IMAGE_TYPES.has(file.mimetype)) {
      return cb(new AppError("Only image files are allowed", 400))
    }
    cb(null, true)
  },
})

function multerError(err) {
  if (!err) return null
  if (err instanceof AppError) return err
  return new AppError(err.message || "Upload failed", 400)
}

export function uploadSingleImage(field = "image") {
  return (req, res, next) => {
    imageUpload.single(field)(req, res, (err) => next(multerError(err) || undefined))
  }
}

export function uploadImageFields(fields) {
  return (req, res, next) => {
    imageUpload.fields(fields)(req, res, (err) => next(multerError(err) || undefined))
  }
}

function pickFile(req, fileField) {
  if (req.file && (!fileField || req.file.fieldname === fileField)) return req.file
  const list = req.files?.[fileField]
  return Array.isArray(list) ? list[0] : null
}

function folderFor(req, kind) {
  const storeId = req.storeId || req.user?.store_id || "platform"
  return `pak-pos/${storeId}/${kind}`
}

export function applyCloudinaryImage({
  fileField = "image",
  bodyField = "image_url",
  kind = "uploads",
} = {}) {
  return async (req, res, next) => {
    try {
      const file = pickFile(req, fileField)
      if (!file) return next()
      const result = await uploadImageBuffer(file.buffer, {
        folder: folderFor(req, kind),
        filename: file.originalname,
      })
      req.body = req.body || {}
      req.body[bodyField] = result.secure_url
      req.uploaded = req.uploaded || {}
      req.uploaded[bodyField] = publicUpload(result)
      next()
    } catch (err) {
      next(err)
    }
  }
}

export function applyCloudinaryImages(mappings) {
  return async (req, res, next) => {
    try {
      req.body = req.body || {}
      req.uploaded = req.uploaded || {}
      for (const mapping of mappings) {
        const file = pickFile(req, mapping.fileField)
        if (!file) continue
        const result = await uploadImageBuffer(file.buffer, {
          folder: folderFor(req, mapping.kind || mapping.fileField),
          filename: file.originalname,
        })
        req.body[mapping.bodyField] = result.secure_url
        req.uploaded[mapping.bodyField] = publicUpload(result)
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}
