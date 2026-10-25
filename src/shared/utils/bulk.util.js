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

/**
 * POS reply for a bulk request: data = the created rows (POS shape). Rows that failed are listed
 * in failed[] ({ index, message, status }) so the till can see why; when every row failed the
 * reply is an error with the first failure's message and status.
 */
export function posBulkResponse(res, result, message, created) {
  if (result.created_count === 0 && result.failed_count > 0) {
    const first = result.failed[0]
    return res.status(first.status || 400).json({
      success: false,
      message: first.message,
      data: [],
      failed: result.failed,
    })
  }
  return res.status(bulkStatus(result)).json({
    success: true,
    message,
    data: created,
    ...(result.failed_count ? { failed: result.failed } : {}),
  })
}
