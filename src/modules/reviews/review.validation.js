import { AppError } from "../../shared/errors/AppError.js"
import { REVIEW_STATUS } from "../../db/enums.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function optionalString(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  return String(body[key]).trim()
}

export function parseCreateReview(body) {
  const product_id = String(body.product_id || "")
  if (!UUID_RE.test(product_id)) throw new AppError("product_id must be a UUID", 400)
  const rating = Number(body.rating)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new AppError("rating must be an integer from 1 to 5", 400)
  }
  return {
    product_id,
    rating,
    comment: optionalString(body, "comment"),
  }
}

export function parseModerateReview(body) {
  const status = String(body.status || "")
  if (!REVIEW_STATUS.includes(status) || status === "pending") {
    throw new AppError("status must be approved or rejected", 400)
  }
  return { status }
}
