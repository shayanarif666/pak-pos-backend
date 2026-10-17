import { Store } from "../../modules/stores/store.model.js"
import { ForbiddenError } from "../errors/ForbiddenError.js"

export function tenantMiddleware(req, res, next) {
  if (!req.user) {
    return next(new ForbiddenError("Not authenticated"))
  }

  req.storeId = req.user.store_id
  req.storeNumber = req.user.store_id_int ?? req.auth?.store_number ?? null
  // req.auth wins: for the store admin it holds the location chosen with X-Location-Id.
  req.locationId = req.auth?.location_id || req.user.location_id || null
  req.locationNumber = req.auth?.location_number ?? req.user.location_id_int ?? null
  req.storeIdInt = req.storeNumber
  next()
}

// A suspended store keeps its data but its staff and customers can no longer use the API.
export async function requireTenantStore(req, res, next) {
  try {
    if (!req.storeId) throw new ForbiddenError("No store on this account")
    const store = await Store.findByPk(req.storeId, { attributes: ["id", "is_active"] })
    if (!store) throw new ForbiddenError("No store on this account")
    if (!store.is_active) throw new ForbiddenError("This store is suspended")
    next()
  } catch (err) {
    next(err)
  }
}
