import { NotFoundError } from "../errors/NotFoundError.js"

export function notFoundMiddleware(req, res, next) {
  next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`))
}
