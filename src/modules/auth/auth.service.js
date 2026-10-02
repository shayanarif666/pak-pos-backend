import jwt from "jsonwebtoken"
import { Op, UniqueConstraintError } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { env, isProduction } from "../../config/env.js"
import { User } from "./user.model.js"
import { UserSession } from "./userSession.model.js"
import { AuthToken } from "./authToken.model.js"
import { Customer } from "../customers/customer.model.js"
import { Store } from "../stores/store.model.js"
import { StoreLicense } from "../stores/storeLicense.model.js"
import { Location } from "../locations/location.model.js"
import { PosDevice } from "../pos/posDevice.model.js"
import { findLiveStoreBySlug, publicStore } from "../stores/store.service.js"
import { visibilityFromRecordChannel } from "../../db/channelVisibility.js"
import { publicLicense, validateLicenseKey } from "../stores/license.service.js"
import { hashPassword, comparePassword } from "../../shared/utils/hash.util.js"
import { hashToken, randomToken } from "../../shared/utils/token.util.js"
import { isExpired } from "../../shared/utils/date.util.js"
import { writeAudit } from "../../shared/utils/audit.util.js"
import {
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
} from "../../shared/utils/mail.util.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { UnauthorizedError } from "../../shared/errors/UnauthorizedError.js"
import { AppError } from "../../shared/errors/AppError.js"

const RESET_TTL_MS = 60 * 60 * 1000
const VERIFY_TTL_MS = 7 * 24 * 60 * 60 * 1000
const STAFF_ROLES = new Set(["store_admin", "manager", "cashier"])

// PIN is only echoed on staff-management screens, never on login / me.
export function publicUser(user, { includePin = false } = {}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    ...(includePin ? { pin: user.pin || null } : {}),
    role: user.role,
    store_id: user.store_id,
    store_number: user.store_id_int,
    location_id: user.location_id,
    location_number: user.location_id_int,
    is_verified: user.is_verified,
    is_active: user.is_active,
    last_login_at: user.last_login_at,
  }
}

function publicLocation(row) {
  if (!row) return null
  return {
    id: row.id,
    store_id: row.store_id,
    location_number: row.location_id_int,
    name: row.name,
    address_line: row.address_line,
    city: row.city,
    country: row.country,
    postal_code: row.postal_code,
    phone: row.phone,
    is_default: row.is_default,
    is_active: row.is_active,
  }
}

function publicDevice(row) {
  if (!row) return null
  return {
    id: row.id,
    location_id: row.location_id,
    location_number: row.location_id_int,
    device_uid: row.device_uid,
    name: row.name,
    platform: row.platform,
    app_version: row.app_version,
    last_seen_at: row.last_seen_at,
    is_active: row.is_active,
  }
}

async function licenseForLocation(storeId, locationId) {
  const license = await StoreLicense.findOne({
    where: { store_id: storeId },
    include: [
      {
        model: PosDevice,
        as: "device",
        required: true,
        where: { location_id: locationId },
      },
    ],
    order: [["updated_at", "DESC"]],
  })
  return license ? publicLicense(license) : null
}

async function devicesForLocation(storeId, locationId) {
  const rows = await PosDevice.findAll({
    where: { store_id: storeId, location_id: locationId },
    order: [["created_at", "ASC"]],
  })
  return rows.map(publicDevice)
}

async function buildStaffSession(user) {
  if (!user.store_id || !STAFF_ROLES.has(user.role)) return {}

  const store = await Store.findByPk(user.store_id)
  const storeInfo = publicStore(store)

  if (user.role === "store_admin") {
    const locations = await Location.findAll({
      where: { store_id: user.store_id },
      order: [
        ["is_default", "DESC"],
        ["location_id_int", "ASC"],
      ],
    })
    const locationsInfo = []
    for (const loc of locations) {
      const devices = await devicesForLocation(user.store_id, loc.id)
      const license = await licenseForLocation(user.store_id, loc.id)
      locationsInfo.push({
        ...publicLocation(loc),
        license,
        devices,
        device_count: devices.length,
      })
    }
    return {
      store: storeInfo,
      locations: locationsInfo,
    }
  }

  const location = user.location_id
    ? await Location.findOne({
        where: { id: user.location_id, store_id: user.store_id },
      })
    : null
  const devices = location ? await devicesForLocation(user.store_id, location.id) : []
  const license = location ? await licenseForLocation(user.store_id, location.id) : null

  return {
    store: storeInfo,
    location: location
      ? {
          ...publicLocation(location),
          license,
          devices,
          device_count: devices.length,
        }
      : null,
  }
}

async function tokenClaims(user) {
  if (!user.store_id) {
    return {
      store_id: null,
      location_id: null,
      store_number: null,
      location_number: null,
    }
  }
  const store = await Store.findByPk(user.store_id)
  return {
    store_id: user.store_id,
    location_id: user.location_id || store?.default_location_id || null,
    store_number: user.store_id_int ?? null,
    location_number: user.location_id_int ?? store?.default_location_id_int ?? null,
  }
}

function posClaims(pos) {
  if (!pos) return {}
  return { channel: "pos", license_id: pos.license_id, device_id: pos.device_id }
}

function signTokens(user, extras = {}, pos = null, sid = null) {
  const access_token = jwt.sign(
    {
      sub: user.id,
      sid,
      role: user.role,
      store_id: extras.store_id ?? user.store_id ?? null,
      location_id: extras.location_id ?? user.location_id ?? null,
      store_number: extras.store_number ?? user.store_id_int ?? null,
      location_number: extras.location_number ?? user.location_id_int ?? null,
      tv: user.token_version ?? 0,
      ...posClaims(pos),
      type: "access",
    },
    env.JWT_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN }
  )

  const refresh_token = jwt.sign(
    { sub: user.id, sid, tv: user.token_version ?? 0, ...posClaims(pos), type: "refresh" },
    env.JWT_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN }
  )

  return { access_token, refresh_token, expires_in: env.JWT_ACCESS_EXPIRES_IN }
}

function refreshExpiry(refreshToken) {
  const { exp } = jwt.decode(refreshToken) || {}
  return exp ? new Date(exp * 1000) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
}

/**
 * One session row per signed-in device. Tokens carry its id (sid), so logout revokes only
 * this device and a second login no longer overwrites the first device's refresh token.
 */
async function startSession(user, { pos = null, channel = null, meta = {}, transaction } = {}) {
  const session = await UserSession.create(
    {
      user_id: user.id,
      channel: pos ? "pos" : channel,
      device_id: pos?.device_id || null,
      license_id: pos?.license_id || null,
      ip_address: meta.ip || null,
      user_agent: meta.userAgent || null,
      expires_at: new Date(),
    },
    { transaction }
  )
  const tokens = signTokens(user, await tokenClaims(user), pos, session.id)
  await session.update(
    {
      refresh_token_hash: await hashPassword(tokens.refresh_token),
      expires_at: refreshExpiry(tokens.refresh_token),
    },
    { transaction }
  )
  return tokens
}

/** Throws unless the access/refresh token's session is still open. */
export async function assertSessionOpen(payload) {
  if (!payload.sid) throw new UnauthorizedError("Session has ended. Sign in again.")
  const session = await UserSession.findByPk(payload.sid)
  if (!session || session.user_id !== payload.sub || session.revoked_at) {
    throw new UnauthorizedError("Session has ended. Sign in again.")
  }
  if (new Date(session.expires_at) < new Date()) {
    throw new UnauthorizedError("Session has expired. Sign in again.")
  }
  return session
}

export async function issueUserSession(user, meta = {}) {
  const tokens = await startSession(user, { channel: "web", meta })
  return {
    ...tokens,
    user: publicUser(user),
  }
}

async function issueAuthToken(user, type, ttlMs, transaction) {
  await AuthToken.update(
    { used_at: new Date() },
    {
      where: { user_id: user.id, type, used_at: null },
      transaction,
    }
  )

  const token = randomToken()
  await AuthToken.create(
    {
      user_id: user.id,
      type,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + ttlMs),
    },
    { transaction }
  )
  return token
}

async function consumeAuthToken(raw, type) {
  const row = await AuthToken.findOne({
    where: {
      token_hash: hashToken(raw),
      type,
      used_at: null,
      expires_at: { [Op.gt]: new Date() },
    },
  })
  if (!row) throw new AppError("Token is invalid or expired", 400)

  const user = await User.findByPk(row.user_id)
  if (!user || !user.is_active) {
    throw new AppError("Token is invalid or expired", 400)
  }

  await row.update({ used_at: new Date() })
  return user
}

function maybeRevealToken(token) {
  return isProduction ? undefined : token
}

async function findUsersByEmail(email) {
  return User.findAll({ where: { email } })
}

async function resolveUserByStoreScope({ email, store_slug, license_key }) {
  if (license_key) {
    const license = await StoreLicense.findOne({ where: { license_key } })
    if (!license) return null
    return User.findOne({ where: { email, store_id: license.store_id } })
  }

  if (store_slug) {
    const store = await Store.findOne({ where: { slug: store_slug } })
    if (!store) return null
    return User.findOne({ where: { email, store_id: store.id } })
  }

  const matches = await findUsersByEmail(email)
  if (matches.length > 1) {
    throw new AppError("store_slug or license_key is required", 400)
  }
  return matches[0] || null
}

// PIN is always looked up inside one store and only for store staff.
// A platform-wide PIN search let any 4-digit guess (even the Super Admin's PIN) sign in.
async function findUserByPin(pin, storeId) {
  if (!storeId) return null
  return User.findOne({
    where: { pin, store_id: storeId, role: { [Op.in]: [...STAFF_ROLES] } },
  })
}

// POS sessions are bound to an active device registered on the license.
async function resolvePosDevice(input, license) {
  const where = { store_id: license.store_id }
  if (input.device_id) where.id = input.device_id
  else if (input.device_uid) where.device_uid = input.device_uid
  else throw new AppError("device_uid is required for POS login", 400)

  const device = await PosDevice.findOne({ where })
  if (!device) throw new AppError("This device is not registered for this license", 403)
  if (!device.is_active) throw new AppError("This device has been deactivated", 403)
  const bound = (license.device_uuids || []).some(
    (entry) => entry?.device_uid === device.device_uid
  )
  if (!bound) throw new AppError("This device is not registered for this license", 403)
  return device
}

async function resolvePosLogin(input) {
  const license = await validateLicenseKey(input.license_key)
  const device = await resolvePosDevice(input, license)
  return { license, device }
}

async function resolvePinLoginUser(input) {
  if (input.channel === "pos") {
    const { license, device } = await resolvePosLogin(input)
    const user = await findUserByPin(input.pin, license.store_id)
    return { user, channel: "pos", pos: { license_id: license.id, device_id: device.id } }
  }

  if (input.license_key) {
    const license = await StoreLicense.findOne({
      where: { license_key: input.license_key },
    })
    const user = license ? await findUserByPin(input.pin, license.store_id) : null
    return { user, channel: input.channel || "web" }
  }

  if (input.store_slug) {
    const store = await Store.findOne({ where: { slug: input.store_slug } })
    const user = store ? await findUserByPin(input.pin, store.id) : null
    return { user, channel: input.channel || "web" }
  }

  throw new AppError("license_key or store_slug is required for PIN login", 400)
}

async function resolveLoginUser(input) {
  if (input.pin) return resolvePinLoginUser(input)

  const email = input.email.toLowerCase()

  if (input.channel === "pos") {
    const { license, device } = await resolvePosLogin(input)
    const user = await User.findOne({
      where: { email, store_id: license.store_id },
    })
    if (user && !STAFF_ROLES.has(user.role)) {
      throw new UnauthorizedError("Invalid credentials")
    }
    return { user, channel: "pos", pos: { license_id: license.id, device_id: device.id } }
  }

  const user = await resolveUserByStoreScope({
    email,
    store_slug: input.store_slug,
    license_key: input.license_key,
  })
  return { user, channel: input.channel || "web" }
}

async function verifyCredentials(user, { password, pin }) {
  if (!user || !user.is_active) {
    throw new UnauthorizedError("Invalid credentials")
  }

  if (password) {
    const ok = await comparePassword(password, user.password)
    if (!ok) throw new UnauthorizedError("Invalid credentials")
    return
  }

  if (!user.pin || user.pin !== pin) {
    throw new UnauthorizedError("Invalid credentials")
  }
}

/** POS tokens stay valid only while their license is active and their device is enabled. */
export async function assertPosSessionUsable(storeId, { license_id, device_id }) {
  const [license, device] = await Promise.all([
    license_id ? StoreLicense.findOne({ where: { id: license_id, store_id: storeId } }) : null,
    device_id ? PosDevice.findOne({ where: { id: device_id, store_id: storeId } }) : null,
  ])
  if (!license) throw new UnauthorizedError("POS license not found")
  if (license.status === "active" && isExpired(license.expires_at)) {
    await license.update({ status: "expired" })
  }
  if (license.status !== "active") {
    throw new UnauthorizedError(`POS license is ${license.status}`)
  }
  if (!device || !device.is_active) {
    throw new UnauthorizedError("POS device is deactivated")
  }
}

export async function login(input, meta = {}) {
  const { user, channel, pos } = await resolveLoginUser(input)
  await verifyCredentials(user, input)

  const last_login_at = new Date()
  const tokens = await startSession(user, { pos, channel, meta })
  await user.update({ last_login_at })
  user.last_login_at = last_login_at

  await writeAudit({
    action: "login",
    entity_type: "users",
    entity_id: user.id,
    store_id: user.store_id,
    store_id_int: user.store_id_int,
    location_id: user.location_id,
    location_id_int: user.location_id_int,
    user_id: user.id,
    channel,
    ip_address: meta.ip,
    user_agent: meta.userAgent,
  })

  return {
    ...tokens,
    user: publicUser(user),
    ...(pos ? { device_id: pos.device_id, license_id: pos.license_id } : {}),
    ...(await buildStaffSession(user)),
  }
}

export async function refreshSession(refreshToken) {
  let payload
  try {
    payload = jwt.verify(refreshToken, env.JWT_SECRET)
  } catch {
    throw new UnauthorizedError("Invalid refresh token")
  }

  if (payload.type !== "refresh") {
    throw new UnauthorizedError("Invalid token type")
  }

  const user = await User.findByPk(payload.sub)
  if (!user || !user.is_active) {
    throw new UnauthorizedError("Invalid refresh token")
  }

  if ((payload.tv ?? 0) !== (user.token_version ?? 0)) {
    throw new UnauthorizedError("Session has ended")
  }

  const session = await assertSessionOpen(payload)
  const match =
    session.refresh_token_hash &&
    (await comparePassword(refreshToken, session.refresh_token_hash))
  if (!match) throw new UnauthorizedError("Invalid refresh token")

  const pos =
    payload.channel === "pos"
      ? { license_id: payload.license_id, device_id: payload.device_id }
      : null
  if (pos) await assertPosSessionUsable(user.store_id, pos)

  // Rotate: the old refresh token stops working once the new one is issued.
  const tokens = signTokens(user, await tokenClaims(user), pos, session.id)
  await session.update({
    refresh_token_hash: await hashPassword(tokens.refresh_token),
    expires_at: refreshExpiry(tokens.refresh_token),
  })
  return {
    ...tokens,
    user: publicUser(user),
    ...(await buildStaffSession(user)),
  }
}

export async function logout(user, meta = {}) {
  // Ends only the session (device) that called logout; other devices stay signed in.
  if (meta.sid) {
    await UserSession.update(
      { revoked_at: new Date(), refresh_token_hash: null },
      { where: { id: meta.sid, user_id: user.id } }
    )
  }
  await writeAudit({
    action: "logout",
    entity_type: "users",
    entity_id: user.id,
    store_id: user.store_id,
    store_id_int: user.store_id_int,
    location_id: user.location_id,
    location_id_int: user.location_id_int,
    user_id: user.id,
    ip_address: meta.ip,
    user_agent: meta.userAgent,
  })
}

export async function getMe(user) {
  return {
    user: publicUser(user),
    ...(await buildStaffSession(user)),
  }
}

export async function patchMe(user, fields) {
  const patch = {}
  if (fields.name !== undefined) patch.name = fields.name
  if (fields.phone !== undefined) patch.phone = fields.phone

  if (fields.password) {
    const ok = await comparePassword(fields.current_password, user.password)
    if (!ok) throw new UnauthorizedError("Current password is incorrect")
    patch.password = await hashPassword(fields.password)
  }

  if (fields.pin) {
    if (!STAFF_ROLES.has(user.role) || !user.store_id) {
      throw new AppError("PIN is only for store staff", 400)
    }
    const taken = await User.findOne({
      where: {
        store_id: user.store_id,
        pin: fields.pin,
        id: { [Op.ne]: user.id },
      },
    })
    if (taken) throw new ConflictError("PIN is already used in this store")
    patch.pin = fields.pin
  }

  try {
    await user.update(patch)
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new ConflictError("PIN is already used in this store")
    }
    throw err
  }

  return publicUser(user)
}

export async function registerCustomer(input) {
  const store = await findLiveStoreBySlug(input.store_slug)
  if (!store) throw new AppError("Store not found or not live", 404)

  const email = input.email.toLowerCase()

  return sequelize.transaction(async (transaction) => {
    const taken = await User.findOne({
      where: { store_id: store.id, email },
      transaction,
    })
    if (taken) throw new ConflictError("Email already registered")

    const user = await User.create(
      {
        store_id: store.id,
        store_id_int: store.store_id_int,
        location_id: store.default_location_id,
        location_id_int: store.default_location_id_int,
        name: input.name,
        email,
        password: await hashPassword(input.password),
        phone: input.phone,
        role: "customer",
        pin: null,
        is_verified: false,
        is_active: true,
      },
      { transaction }
    )

    await Customer.create(
      {
        store_id: store.id,
        store_id_int: store.store_id_int,
        location_id: store.default_location_id,
        user_id: user.id,
        name: input.name,
        email,
        phone: input.phone,
        total_debt: 0,
        remaining_debt: 0,
        debt_notes: null,
        is_active: true,
        ...visibilityFromRecordChannel("web"),
      },
      { transaction }
    )

    const verify_token = await issueAuthToken(
      user,
      "email_verify",
      VERIFY_TTL_MS,
      transaction
    )
    const tokens = await startSession(user, { channel: "web", transaction })

    return {
      ...tokens,
      user: publicUser(user),
      verify_token: maybeRevealToken(verify_token),
    }
  })
}

export async function forgotPassword(input) {
  const generic = {
    message: "If the account exists, a reset token was issued",
  }

  let user
  try {
    user = await resolveUserByStoreScope({
      email: input.email.toLowerCase(),
      store_slug: input.store_slug,
      license_key: input.license_key,
    })
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 400) throw err
    return generic
  }

  if (!user || !user.is_active) return generic

  const token = await issueAuthToken(user, "password_reset", RESET_TTL_MS)
  await sendPasswordResetEmail(user, token)
  return { ...generic, reset_token: maybeRevealToken(token) }
}

export async function resetPassword(input) {
  const user = await consumeAuthToken(input.token, "password_reset")
  await user.update({
    password: await hashPassword(input.password),
    refresh_token_hash: null,
    token_version: (user.token_version ?? 0) + 1,
  })
  await sendPasswordChangedEmail(user)
  return publicUser(user)
}

export async function verifyEmail(input) {
  const user = await consumeAuthToken(input.token, "email_verify")
  await user.update({ is_verified: true })
  return publicUser(user)
}
