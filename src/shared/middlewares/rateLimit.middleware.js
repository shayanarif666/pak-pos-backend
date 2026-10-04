import { AppError } from "../errors/AppError.js"

const windows = new Map()
const SWEEP_MS = 60 * 1000
let lastSweep = Date.now()

// Drop buckets whose newest hit is older than their window so the map cannot grow forever.
function sweep(now) {
  if (now - lastSweep < SWEEP_MS) return
  lastSweep = now
  for (const [key, bucket] of windows) {
    if (!bucket.hits.length || now - bucket.hits[bucket.hits.length - 1] >= bucket.windowMs) {
      windows.delete(key)
    }
  }
}

// Scope a bucket to the account being attacked, not only the IP: behind a proxy many tills
// can share one IP, and PIN logins have no email to tell them apart.
function defaultScope(req) {
  const body = req.body || {}
  return String(body.email || body.license_key || body.store_slug || "").toLowerCase()
}

/**
 * failuresOnly: count only requests that end in an error response. Used for login, where a
 * shop's tills share one IP and successful PIN sign-ins at shift change must not lock them out.
 */
export function rateLimit({
  windowMs = 15 * 60 * 1000,
  max = 10,
  scope = defaultScope,
  failuresOnly = false,
} = {}) {
  return (req, res, next) => {
    const now = Date.now()
    sweep(now)

    const key = `${req.baseUrl}${req.path}:${req.ip}:${scope(req)}`
    const bucket = windows.get(key) || { windowMs, hits: [] }
    bucket.hits = bucket.hits.filter((ts) => now - ts < windowMs)

    if (bucket.hits.length >= max) {
      return next(new AppError("Too many attempts. Try again later.", 429))
    }

    if (failuresOnly) {
      res.on("finish", () => {
        if (res.statusCode < 400 || res.statusCode === 429) return
        bucket.hits.push(Date.now())
        windows.set(key, bucket)
      })
    } else {
      bucket.hits.push(now)
      windows.set(key, bucket)
    }
    next()
  }
}
