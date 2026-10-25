import { Location } from "../../modules/locations/location.model.js"
import { ForbiddenError } from "../errors/ForbiddenError.js"
import { NotFoundError } from "../errors/NotFoundError.js"

/**
 * The location a bulk request names once, next to items[]: { locationId: 1, items: [...] }
 * (location number or UUID; location_id also works). Any role may send it — a store admin may
 * name any location, a manager / cashier only their own. Not sent = null (the token's location).
 */
export async function bulkLocation(req) {
  const ref = req.body?.locationId ?? req.body?.location_id
  if (ref === undefined || ref === null || String(ref).trim() === "") return null
  const value = String(ref).trim()
  const storeId = req.auth?.store_id || req.user.store_id
  const location = await Location.findOne({
    where: /^[0-9]+$/.test(value)
      ? { store_id: storeId, location_id_int: Number(value) }
      : { store_id: storeId, id: value },
  })
  if (!location) throw new NotFoundError("Location not found")
  if (req.user.role !== "store_admin") {
    const own = req.auth?.location_id || req.user.location_id
    if (location.id !== own) throw new ForbiddenError("You can only use your own location")
  }
  return location
}
