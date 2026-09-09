import { ForbiddenError } from "../errors/ForbiddenError.js"

export function tenantMiddleware(req, res, next) {
  if (!req.user) {
    return next(new ForbiddenError("Not authenticated"))
  }

  req.storeId = req.user.store_id
  req.storeNumber = req.user.store_id_int ?? req.auth?.store_number ?? null
  req.locationId = req.user.location_id || req.auth?.location_id || null
  req.locationNumber = req.user.location_id_int ?? req.auth?.location_number ?? null
  req.storeIdInt = req.storeNumber
  next()
}

export function requireTenantStore(req, res, next) {
  if (!req.storeId) {
    return next(new ForbiddenError("No store on this account"))
  }
  next()
}
