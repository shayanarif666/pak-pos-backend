import { AppError } from "../errors/AppError.js"

const windows = new Map()

export function rateLimit({ windowMs = 15 * 60 * 1000, max = 10 } = {}) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}:${req.body?.email || ""}`
    const now = Date.now()
    const bucket = windows.get(key) || []
    const recent = bucket.filter((ts) => now - ts < windowMs)

    if (recent.length >= max) {
      return next(new AppError("Too many attempts. Try again later.", 429))
    }

    recent.push(now)
    windows.set(key, recent)
    next()
  }
}
