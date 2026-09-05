import { ForbiddenError } from "../errors/ForbiddenError.js"

export function tenantMiddleware(req, res, next) {
  if (!req.user) {
    return next(new ForbiddenError("Not authenticated"))
  }

  req.storeId = req.user.store_id
  req.storeIdInt = req.user.store_id_int
  next()
}

export function requireTenantStore(req, res, next) {
  if (!req.storeId) {
    return next(new ForbiddenError("No store on this account"))
  }
  next()
}
