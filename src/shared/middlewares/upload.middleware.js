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

export function uploadProductImages() {
  return uploadImageFields([
    { name: "featured", maxCount: 1 },
    { name: "images", maxCount: 12 },
    { name: "image", maxCount: 1 },
  ])
}

function parseImageList(raw) {
  if (raw == null || raw === "") return []
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === "string" && item.trim()) return { url: item.trim() }
        if (item && typeof item === "object" && item.url) return { url: String(item.url) }
        return null
      })
      .filter(Boolean)
  }
  if (typeof raw === "string") {
    try {
      return parseImageList(JSON.parse(raw))
    } catch {
      return raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((url) => ({ url }))
    }
  }
  return []
}

export function applyProductImages({ kind = "products" } = {}) {
  return async (req, res, next) => {
    try {
      req.body = req.body || {}
      const folder = folderFor(req, kind)
      const hasLegacy = Boolean(pickFile(req, "image"))
      const hasFeaturedFile = Boolean(pickFile(req, "featured"))
      const galleryFiles = Array.isArray(req.files?.images) ? req.files.images : []
      const hasGalleryFiles = galleryFiles.length > 0
      const hasExplicitImages =
        req.body.images !== undefined ||
        req.body.existing_images !== undefined ||
        req.body.featured_image !== undefined

      if (!hasLegacy && !hasFeaturedFile && !hasGalleryFiles && !hasExplicitImages) {
        return next()
      }

      const existing = parseImageList(req.body.images || req.body.existing_images)
      const uploaded = []

      for (const file of galleryFiles) {
        const result = await uploadImageBuffer(file.buffer, {
          folder,
          filename: file.originalname,
        })
        uploaded.push({ url: result.secure_url })
      }

      let featuredUrl =
        typeof req.body.featured_image === "string" && req.body.featured_image.trim()
          ? req.body.featured_image.trim()
          : null

      const featuredFile = pickFile(req, "featured")
      if (featuredFile) {
        const result = await uploadImageBuffer(featuredFile.buffer, {
          folder,
          filename: featuredFile.originalname,
        })
        featuredUrl = result.secure_url
      }

      // Backward compatible single "image" upload maps to featured + gallery.
      const legacyFile = pickFile(req, "image")
      if (legacyFile) {
        const result = await uploadImageBuffer(legacyFile.buffer, {
          folder,
          filename: legacyFile.originalname,
        })
        featuredUrl = result.secure_url
        uploaded.push({ url: result.secure_url })
      }

      let images = [...existing, ...uploaded]
      const seen = new Set()
      images = images.filter((item) => {
        if (!item?.url || seen.has(item.url)) return false
        seen.add(item.url)
        return true
      })

      if (!featuredUrl && images.length) featuredUrl = images[0].url
      if (featuredUrl && !images.some((item) => item.url === featuredUrl)) {
        images = [{ url: featuredUrl }, ...images]
      }
      if (images.length === 1) {
        featuredUrl = images[0].url
      }

      req.body.images = images
      req.body.featured_image = featuredUrl
      req.body.image_url = featuredUrl
      next()
    } catch (err) {
      next(err)
    }
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
