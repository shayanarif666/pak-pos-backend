import { Location } from "../../modules/locations/location.model.js"
import { AppError } from "../errors/AppError.js"
import { ForbiddenError } from "../errors/ForbiddenError.js"
import { NotFoundError } from "../errors/NotFoundError.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const STORE_KEYS = ["store_id", "storeId"]
const LOCATION_KEYS = ["location_id", "locationId"]
const BATCH_KEYS = ["batch_id", "batchId", "register_session_id"]

const present = (value) => value !== undefined && value !== null && String(value).trim() !== ""
const firstOf = (body, keys) => keys.map((key) => body?.[key]).find(present)
const drop = (body, keys) => keys.forEach((key) => delete body[key])

async function findLocation(storeId, ref) {
  const value = String(ref).trim()
  const where = { store_id: storeId }
  if (/^\d+$/.test(value)) where.location_id_int = Number(value)
  else if (UUID_RE.test(value)) where.id = value
  else throw new AppError("location_id must be a location number or UUID", 400)
  const found = await Location.findOne({ where, attributes: ["id", "location_id_int"] })
  if (!found) throw new NotFoundError("Location not found")
  return found
}

/**
 * The store / location / staff / batch of a POS write. Each may come once at the top of the body
 * (next to items[]) or on the items themselves — both work; when both are sent, one is kept:
 * - store_id (number or UUID): wherever it is sent it must be the token's store (else 403); it is
 *   never saved from the body, so it is checked and removed.
 * - location_id (number or UUID), on location-bound endpoints: the top one wins; without it, the
 *   items' one is used (they must all name the same location). A store admin's becomes the
 *   request's location; a manager / cashier may only name their own (else 403). Endpoints with a
 *   location_scope (catalog, suppliers, offers, staff) pass { location: false } and keep theirs.
 *   { itemLocation: true } (customers): each row keeps its own location, the top one fills the rest.
 * - staff_id / batch_id: an item's own wins; the top one fills the items without one.
 * Fields the backend does not know are ignored further down by each endpoint's validation.
 */
export function requestScope({ location = true, itemLocation = false, staffKeys = ["staff_id", "staffId"] } = {}) {
  return async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : null
      if (!body || !req.auth) return next()
      const items = Array.isArray(body.items) ? body.items.filter((item) => item && typeof item === "object") : []

      // Store: check every store id sent (top and items), then remove them.
      for (const holder of [body, ...items]) {
        const ref = firstOf(holder, STORE_KEYS)
        if (ref === undefined) continue
        const value = String(ref).trim()
        const same = /^\d+$/.test(value) ? Number(value) === Number(req.auth.store_number) : value === req.auth.store_id
        if (!same) throw new ForbiddenError("store_id does not match your store")
        drop(holder, STORE_KEYS)
      }

      if (location) {
        const own = req.auth.role === "store_admin" ? null : req.auth.location_id
        const allow = (found) => {
          if (own && found.id !== own) throw new ForbiddenError("You can only use your own location")
          return found
        }
        const topRef = firstOf(body, LOCATION_KEYS)

        if (itemLocation) {
          // Each row keeps its own location (as a UUID); the top one fills the rest.
          const top = topRef === undefined ? null : allow(await findLocation(req.auth.store_id, topRef))
          for (const item of items) {
            const ref = firstOf(item, LOCATION_KEYS)
            const found = ref === undefined ? top : allow(await findLocation(req.auth.store_id, ref))
            drop(item, LOCATION_KEYS)
            if (found) item.location_id = found.id
          }
        } else {
          // One location per request: the top one, else the one the items name.
          let ref = topRef
          if (ref === undefined) {
            const named = [...new Set(items.map((item) => firstOf(item, LOCATION_KEYS)).filter((v) => v !== undefined).map(String))]
            if (named.length) {
              const found = await Promise.all(named.map((value) => findLocation(req.auth.store_id, value)))
              if (new Set(found.map((row) => row.id)).size > 1) {
                throw new AppError("Items name different locations — send one locationId before items[]", 400)
              }
              ref = found[0].id
            }
          }
          if (ref !== undefined) {
            const found = allow(await findLocation(req.auth.store_id, ref))
            if (req.auth.role === "store_admin") {
              req.auth.location_id = found.id
              req.auth.location_number = found.location_id_int
              req.locationId = found.id
              req.locationNumber = found.location_id_int
            }
            drop(body, LOCATION_KEYS)
            body.location_id = found.id
          }
          // The request's location is used for every item; theirs would be a second copy.
          for (const item of items) drop(item, LOCATION_KEYS)
        }
      }

      // Staff / batch: the item's own wins, the top one fills the rest (batch_id is the name read).
      const staff = firstOf(body, ["staff_id", "staffId"])
      const batch = firstOf(body, BATCH_KEYS)
      for (const item of items) {
        if (staff !== undefined && firstOf(item, staffKeys) === undefined) item.staff_id = staff
        const itemBatch = firstOf(item, BATCH_KEYS)
        if (itemBatch !== undefined) {
          if (!present(item.batch_id)) item.batch_id = itemBatch
        } else if (batch !== undefined) {
          item.batch_id = batch
        }
      }
      if (batch !== undefined && !present(body.batch_id)) body.batch_id = batch
      next()
    } catch (err) {
      next(err)
    }
  }
}
