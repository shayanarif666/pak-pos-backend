import { AppError } from "../errors/AppError.js"

export function extractBulkItems(body) {
  const items = Array.isArray(body) ? body : body?.items
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError("Send a non-empty items array", 400)
  }
  return items
}

export async function runBulk(items, handler) {
  const created = []
  const failed = []
  for (let i = 0; i < items.length; i += 1) {
    try {
      created.push(await handler(items[i], i))
    } catch (err) {
      failed.push({
        index: i,
        message: err.message || "Failed",
        status: err.statusCode || err.status || 400,
      })
    }
  }
  return {
    created,
    failed,
    created_count: created.length,
    failed_count: failed.length,
  }
}

export function bulkStatus(result) {
  return result.failed_count ? 200 : 201
}
