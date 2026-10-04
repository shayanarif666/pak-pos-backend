import jwt from "jsonwebtoken"
import { env } from "../../config/env.js"
import { User } from "../../modules/auth/user.model.js"
import { UnauthorizedError } from "../errors/UnauthorizedError.js"
import {
  assertPosSessionUsable,
  assertSessionOpen,
  assertStaffLicense,
} from "../../modules/auth/auth.service.js"

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
    if ((payload.tv ?? 0) !== (user.token_version ?? 0)) {
      throw new UnauthorizedError("Session has ended. Sign in again.")
    }
    await assertSessionOpen(payload)
    // Expired / suspended store license: 403 with data.code, the dashboard signs the user out.
    // Logout stays allowed so that sign-out can still close the session on the server.
    if (!req.originalUrl.split("?")[0].endsWith("/auth/logout")) {
      await assertStaffLicense(user)
    }
    if (payload.channel === "pos") {
      await assertPosSessionUsable(user.store_id, payload)
    }

    req.user = user
    req.auth = {
      id: user.id,
      role: user.role,
      store_id: user.store_id || payload.store_id || null,
      location_id: user.location_id || payload.location_id || null,
      store_number: user.store_id_int ?? payload.store_number ?? null,
      location_number: user.location_id_int ?? payload.location_number ?? null,
      channel: payload.channel || null,
      device_id: payload.device_id || null,
      license_id: payload.license_id || null,
      sid: payload.sid || null,
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
