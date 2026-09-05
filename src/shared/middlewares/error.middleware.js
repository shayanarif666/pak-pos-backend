import { isProduction } from "../../config/env.js"
import { logger } from "../../config/logger.js"

export function errorMiddleware(err, req, res, _next) {
  const statusCode = err.statusCode || 500
  const message =
    statusCode === 500 && isProduction
      ? "Internal server error"
      : err.message || "Internal server error"

  if (statusCode >= 500) {
    logger.error(err.message, { stack: err.stack, path: req.path })
  }

  res.status(statusCode).json({
    success: false,
    message,
    errors: null,
    ...(isProduction ? {} : { stack: err.stack }),
  })
}
