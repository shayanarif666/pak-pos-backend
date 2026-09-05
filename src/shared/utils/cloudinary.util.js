import { v2 as cloudinary } from "cloudinary"
import { env } from "../../config/env.js"
import { AppError } from "../errors/AppError.js"

let ready = false

function configure() {
  if (ready) return
  if (
    !env.CLOUDINARY_CLOUD_NAME ||
    !env.CLOUDINARY_API_KEY ||
    !env.CLOUDINARY_API_SECRET
  ) {
    throw new AppError("Cloudinary is not configured", 503)
  }
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
  })
  ready = true
}

function uploadBuffer(buffer, options) {
  configure()
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(new AppError(err.message || "Upload failed", 400))
      resolve(result)
    })
    stream.end(buffer)
  })
}

export async function uploadImageBuffer(buffer, { folder, filename } = {}) {
  return uploadBuffer(buffer, {
    folder: folder || "pak-pos/uploads",
    resource_type: "image",
    use_filename: Boolean(filename),
    unique_filename: true,
    overwrite: false,
    filename_override: filename,
  })
}

export async function uploadRawBuffer(buffer, { folder, filename } = {}) {
  return uploadBuffer(buffer, {
    folder: folder || "pak-pos/backups",
    resource_type: "raw",
    use_filename: Boolean(filename),
    unique_filename: true,
    overwrite: false,
    filename_override: filename,
    format: "json",
  })
}

export function publicUpload(result) {
  return {
    url: result.secure_url,
    public_id: result.public_id,
    format: result.format,
    bytes: result.bytes,
    width: result.width || null,
    height: result.height || null,
    resource_type: result.resource_type,
  }
}
