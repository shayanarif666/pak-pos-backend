import jwt from "jsonwebtoken"
import { env } from "../../config/env.js"
import { User } from "../../modules/auth/user.model.js"
import { UnauthorizedError } from "../errors/UnauthorizedError.js"

export async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || ""
    const token = header.startsWith("Bearer ") ? header.slice(7) : null
    if (!token) throw new UnauthorizedError("Missing access token")

    let payload
    try {
      payload = jwt.verify(token, env.JWT_SECRET)
    } catch {
      throw new UnauthorizedError("Invalid or expired token")
    }

    if (payload.type !== "access") {
      throw new UnauthorizedError("Invalid token type")
    }

    const user = await User.findByPk(payload.sub)
    if (!user || !user.is_active) {
      throw new UnauthorizedError("Account is not available")
    }

    req.user = user
    req.auth = {
      id: user.id,
      role: user.role,
      store_id: user.store_id || payload.store_id || null,
      location_id: user.location_id || payload.location_id || null,
      store_number: user.store_id_int ?? payload.store_number ?? null,
      location_number: user.location_id_int ?? payload.location_number ?? null,
    }
    next()
  } catch (err) {
    next(err)
  }
}

export function optionalAuth(req, res, next) {
  const header = req.headers.authorization || ""
  if (!header.startsWith("Bearer ")) return next()
  return authMiddleware(req, res, next)
}
