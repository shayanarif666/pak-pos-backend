import { AppError } from "../../shared/errors/AppError.js"

const KINDS = new Set([
  "uploads",
  "products",
  "categories",
  "banners",
  "logos",
  "favicons",
])

export function parseUploadQuery(query = {}) {
  const kind = String(query.kind || "uploads")
  if (!KINDS.has(kind)) {
    throw new AppError(
      "kind must be uploads, products, categories, banners, logos, or favicons",
      400
    )
  }
  return { kind }
}
