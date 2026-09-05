import { AppError } from "../../shared/errors/AppError.js"

function requireString(body, key, { max = 2000 } = {}) {
  const value = body[key]
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError(`${key} is required`, 400)
  }
  const trimmed = value.trim()
  if (trimmed.length > max) throw new AppError(`${key} is too long`, 400)
  return trimmed
}

function optionalString(body, key, { max = 2000 } = {}) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  if (typeof body[key] !== "string") throw new AppError(`${key} must be a string`, 400)
  const trimmed = body[key].trim()
  if (trimmed.length > max) throw new AppError(`${key} is too long`, 400)
  return trimmed
}

export function parseCreateBanner(body) {
  let sort_order = 0
  if (body.sort_order !== undefined && body.sort_order !== null) {
    sort_order = Number(body.sort_order)
    if (Number.isNaN(sort_order)) throw new AppError("sort_order must be a number", 400)
  }
  return {
    image_url: requireString(body, "image_url"),
    heading: optionalString(body, "heading"),
    link_url: optionalString(body, "link_url"),
    sort_order,
    is_active: body.is_active === undefined ? true : Boolean(body.is_active),
  }
}

export function parsePatchBanner(body) {
  const patch = {}
  if (body.image_url !== undefined) patch.image_url = requireString(body, "image_url")
  if (body.heading !== undefined) patch.heading = optionalString(body, "heading")
  if (body.link_url !== undefined) patch.link_url = optionalString(body, "link_url")
  if (body.sort_order !== undefined) {
    const sort_order = Number(body.sort_order)
    if (Number.isNaN(sort_order)) throw new AppError("sort_order must be a number", 400)
    patch.sort_order = sort_order
  }
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active)
  if (!Object.keys(patch).length) throw new AppError("No fields to update", 400)
  return patch
}
