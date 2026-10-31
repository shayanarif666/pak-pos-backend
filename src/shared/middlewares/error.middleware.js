import { logger } from "../../config/logger.js"

export function errorMiddleware(err, req, res, _next) {
  const statusCode = err.statusCode || 500
  const message =
    statusCode === 500 && process.env.NODE_ENV !== "development"
      ? "Internal server error"
      : err.message || "Internal server error"

  if (statusCode >= 500) {
    logger.error(err.message, { stack: err.stack, path: req.path })
  }

  res.status(statusCode).json({
    success: false,
    message,
    errors: null,
    ...(err.data !== undefined ? { data: err.data } : {}),
    // The stack only on a developer's machine (NODE_ENV=development set on purpose) — never on a
    // deployed server, even one started without NODE_ENV.
    ...(process.env.NODE_ENV === "development" ? { stack: err.stack } : {}),
  })
}
