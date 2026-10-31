import { Location } from "../../modules/locations/location.model.js"
import { AppError } from "../errors/AppError.js"
import { ForbiddenError } from "../errors/ForbiddenError.js"
import { NotFoundError } from "../errors/NotFoundError.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const present = (value) => value !== undefined && value !== null && String(value).trim() !== ""
const firstOf = (body, keys) => keys.map((key) => body[key]).find(present)

/**
 * The store / location / staff / batch a POS write names once, at the top of the body, next to
 * items[]: { store_id, location_id, staff_id, batch_id, items: [...] }.
 * - store_id (number or UUID): must be the token's store, else 403.
 * - location_id (number or UUID), when the endpoint is location-bound: the store admin's choice
 *   is applied by the auth middleware; a manager / cashier may only name their own (else 403).
 *   Endpoints with a location_scope (catalog, suppliers, offers) pass { location: false }.
 * - staff_id / batch_id: copied into every item that does not carry its own.
 * - { itemLocation: true }: rows that save their own location (customers) get the top location.
 */
export function requestScope({ location = true, itemLocation = false, staffKeys = ["staff_id", "staffId"] } = {}) {
  return async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : null
      if (!body || !req.auth) return next()

      const storeRef = firstOf(body, ["store_id", "storeId"])
      if (storeRef !== undefined) {
        const value = String(storeRef).trim()
        const same = /^\d+$/.test(value)
          ? Number(value) === Number(req.auth.store_number)
          : value === req.auth.store_id
        if (!same) throw new ForbiddenError("store_id does not match your store")
        delete body.store_id
        delete body.storeId
      }

      const locationRef = firstOf(body, ["location_id", "locationId"])
      if (location && req.auth.role !== "store_admin") {
        if (locationRef !== undefined) {
          const value = String(locationRef).trim()
          const where = { store_id: req.auth.store_id }
          if (/^\d+$/.test(value)) where.location_id_int = Number(value)
          else if (UUID_RE.test(value)) where.id = value
          else throw new AppError("location_id must be a location number or UUID", 400)
          const found = await Location.findOne({ where, attributes: ["id"] })
          if (!found) throw new NotFoundError("Location not found")
          if (found.id !== req.auth.location_id) throw new ForbiddenError("You can only use your own location")
        }
      }

      if (Array.isArray(body.items)) {
        const staff = firstOf(body, ["staff_id", "staffId"])
        const batch = firstOf(body, ["batch_id", "batchId"])
        body.items = body.items.map((item) => {
          if (!item || typeof item !== "object") return item
          const next = { ...item }
          if (staff !== undefined && firstOf(next, staffKeys) === undefined) next.staff_id = staff
          if (batch !== undefined && firstOf(next, ["batch_id", "batchId", "register_session_id"]) === undefined) next.batch_id = batch
          if (itemLocation && locationRef !== undefined && req.auth.location_id && firstOf(next, ["location_id", "locationId"]) === undefined) {
            next.location_id = req.auth.location_id
          }
          return next
        })
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}
