import jwt from "jsonwebtoken"
import { env } from "../../config/env.js"
import { User } from "../../modules/auth/user.model.js"
import { Location } from "../../modules/locations/location.model.js"
import { UnauthorizedError } from "../errors/UnauthorizedError.js"
import { AppError } from "../errors/AppError.js"
import { NotFoundError } from "../errors/NotFoundError.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
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
    if (user.role === "store_admin") await applyChosenLocation(req)
    next()
  } catch (err) {
    next(err)
  }
}

/**
 * The store admin works across every location of the store. An `X-Location-Id` header (the
 * location's number, e.g. 2, or its UUID) picks the one this request acts on — register
 * sessions, stock, staff and anything else that uses req.auth.location_id. Without the header
 * the admin's own location is used, as before. Other roles stay on their own location.
 */
async function applyChosenLocation(req) {
  const raw = String(req.headers["x-location-id"] || "").trim()
  if (!raw || !req.auth.store_id) return
  const where = { store_id: req.auth.store_id, is_active: true }
  if (/^\d+$/.test(raw)) where.location_id_int = Number(raw)
  else if (UUID_RE.test(raw)) where.id = raw
  else throw new AppError("X-Location-Id must be a location number or UUID", 400)
  const location = await Location.findOne({ where, attributes: ["id", "location_id_int"] })
  if (!location) throw new NotFoundError("Location not found")
  req.auth.location_id = location.id
  req.auth.location_number = location.location_id_int
}

export function optionalAuth(req, res, next) {
  const header = req.headers.authorization || ""
  if (!header.startsWith("Bearer ")) return next()
  return authMiddleware(req, res, next)
}
