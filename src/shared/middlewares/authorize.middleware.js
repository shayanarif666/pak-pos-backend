import { ForbiddenError } from "../errors/ForbiddenError.js"
import { UnauthorizedError } from "../errors/UnauthorizedError.js"

export function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new UnauthorizedError())
    }
    if (roles.length && !roles.includes(req.user.role)) {
      return next(new ForbiddenError("You cannot access this resource"))
    }
    next()
  }
}
