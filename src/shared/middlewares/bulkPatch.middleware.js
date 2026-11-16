import { requestScope } from "./requestScope.middleware.js"

// The names a POST item uses → the names the PATCH handlers read (POST-style bodies on PATCH).
const COMMON = { isActive: "is_active", locationId: "location_id" }

/**
 * PATCH /bulk takes the body of its POST: { storeId, (locationId, staffId…), items: [{ id, ...the
 * POST item fields }] } (orders: orders[] in place of items[]). This turns it into what the
 * handlers read: the list into items[], the POST field names into the stored ones (rename: extra
 * names for this endpoint, item: a last per-item step), then requestScope checks storeId.
 * The older PATCH names still work (an item that already has the stored name keeps it).
 */
export function bulkPatch({ listKeys = [], rename = {}, item = null, scope = {} } = {}) {
  const names = { ...COMMON, ...rename }
  const normalize = (req, res, next) => {
    const body = req.body
    if (body && typeof body === "object" && !Array.isArray(body)) {
      if (!Array.isArray(body.items)) {
        const key = listKeys.find((name) => Array.isArray(body[name]))
        if (key) {
          body.items = body[key]
          delete body[key]
        }
      }
      if (Array.isArray(body.items)) {
        body.items = body.items.map((row) => {
          if (!row || typeof row !== "object" || Array.isArray(row)) return row
          const out = { ...row }
          for (const [from, to] of Object.entries(names)) {
            if (out[from] === undefined) continue
            if (out[to] === undefined) out[to] = out[from]
            delete out[from]
          }
          return item ? item(out) : out
        })
      }
    }
    next()
  }
  return [normalize, requestScope({ location: false, ...scope })]
}

/** A stock movement edit sent like its POST row: stock [{ qty }] (or variants [{ stock [{ qty }] }]) → qty. */
export function movementPatchItem(row) {
  if (row.qty !== undefined) return row
  const stock = Array.isArray(row.stock) ? row.stock : Array.isArray(row.variants) ? row.variants[0]?.stock : null
  const first = Array.isArray(stock) ? stock[0] : null
  const { stock: _stock, variants: _variants, ...rest } = row
  return first && first.qty !== undefined ? { ...rest, qty: first.qty } : rest
}
