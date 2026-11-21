import { asyncHandler } from "./asyncHandler.js"
import { AppError } from "../errors/AppError.js"
import { extractBulkItems, runBulk } from "./bulk.util.js"

/*
 * DELETE /<resource>/bulk — the bulk form of a resource's own delete (as POST / PATCH /bulk):
 * { storeId, items: [{ id, ...that delete's own fields (e.g. reason_note) }] }. Each item runs the very
 * same single delete (DELETE /<resource>/:id) — same rules, same soft delete, same reply — and is saved on
 * its own: the ones that fail are listed in failed[] ({ index, message, status }), the rest still delete.
 * Reply: { success, message, data: [each delete's reply], failed? }; when every item failed, that first error.
 */

/** Runs a single-delete handler once with :id = item.id and the item as its body; resolves with its reply data. */
function callOnce(handler, req, item) {
  return new Promise((resolve, reject) => {
    // The item's own request: everything of the bulk request (user, store, auth…) with this id and body.
    const one = Object.create(req)
    one.params = { ...req.params, id: String(item.id) }
    one.body = item
    let status = 200
    const res = {
      status(code) {
        status = code
        return res
      },
      json(payload) {
        if (status >= 400 || payload?.success === false) {
          reject(Object.assign(new Error(payload?.message || "Failed"), { statusCode: status >= 400 ? status : 400 }))
        } else {
          resolve(payload?.data ?? payload ?? null)
        }
        return res
      },
      send(payload) {
        return res.json(payload)
      },
      set() {
        return res
      },
      setHeader() {},
      end() {
        resolve(null)
      },
    }
    Promise.resolve(handler(one, res, (err) => (err ? reject(err) : resolve(null)))).catch(reject)
  })
}

/** The id of an item: { id } (or a plain number / UUID). */
function idOf(item) {
  const id = item && typeof item === "object" ? item.id : item
  if (id === undefined || id === null || String(id).trim() === "") throw new AppError("Each item needs the id to delete", 400)
  return String(id).trim()
}

export function bulkDelete(handler, message = "Deleted") {
  return asyncHandler(async (req, res) => {
    const items = extractBulkItems(req.body)
    const result = await runBulk(items, async (item) => {
      const id = idOf(item)
      return callOnce(handler, req, item && typeof item === "object" ? { ...item, id } : { id })
    })
    if (!result.created.length && result.failed.length) {
      const first = result.failed[0]
      return res.status(first.status || 400).json({ success: false, message: first.message, data: [], failed: result.failed })
    }
    return res.status(200).json({ success: true, message, data: result.created, ...(result.failed.length ? { failed: result.failed } : {}) })
  })
}
