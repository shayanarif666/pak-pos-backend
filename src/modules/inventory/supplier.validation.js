import { AppError } from "../../shared/errors/AppError.js"
import { SUPPLIER_LOCATION_SCOPE } from "../../db/enums.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function requireString(body, key, { max = 500 } = {}) {
  const value = body[key]
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError(`${key} is required`, 400)
  }
  const trimmed = value.trim()
  if (trimmed.length > max) throw new AppError(`${key} is too long`, 400)
  return trimmed
}

function optionalString(body, key, { max = 2000 } = {}) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  const trimmed = String(body[key]).trim()
  if (trimmed.length > max) throw new AppError(`${key} is too long`, 400)
  return trimmed
}

/**
 * Which branches the supplier delivers to:
 * - location_scope "all"                         -> every location (location_ids ignored)
 * - location_scope "selected" + location_ids [..] -> one branch or several branches
 * Sending only location_ids implies "selected".
 */
function parseLocationScope(body) {
  const hasScope = body.location_scope !== undefined && body.location_scope !== null
  const hasIds = body.location_ids !== undefined && body.location_ids !== null
  // Nothing sent: create defaults to "all" (a manager's supplier goes to their own branch),
  // patch leaves the current branches as they are.
  if (!hasScope && !hasIds) return {}

  let ids = []
  if (hasIds) {
    if (!Array.isArray(body.location_ids)) {
      throw new AppError("location_ids must be an array of location ids", 400)
    }
    // Location numbers (1, 2, 3 — what the POS uses) or location UUIDs (the dashboard).
    ids = [...new Set(body.location_ids.map((value) => String(value).trim()))]
    for (const id of ids) {
      if (!/^[1-9]\d*$/.test(id) && !UUID_RE.test(id)) {
        throw new AppError("location_ids must contain location numbers (1, 2, 3...) or UUIDs", 400)
      }
    }
  }

  const scope = hasScope ? String(body.location_scope) : ids.length ? "selected" : "all"
  if (!SUPPLIER_LOCATION_SCOPE.includes(scope)) {
    throw new AppError("location_scope must be all or selected", 400)
  }
  if (scope === "selected" && !ids.length) {
    throw new AppError("location_ids is required when location_scope is selected", 400)
  }
  return { location_scope: scope, location_ids: scope === "selected" ? ids : [] }
}

export function parseCreateSupplier(body) {
  return {
    name: requireString(body, "name"),
    phone: optionalString(body, "phone"),
    email: optionalString(body, "email"),
    address: optionalString(body, "address"),
    payment_terms: optionalString(body, "payment_terms"),
    ...parseLocationScope(body),
  }
}

export function parsePatchSupplier(body) {
  const patch = {}
  if (body.name !== undefined) patch.name = requireString(body, "name")
  if (body.phone !== undefined) patch.phone = optionalString(body, "phone")
  if (body.email !== undefined) patch.email = optionalString(body, "email")
  if (body.address !== undefined) patch.address = optionalString(body, "address")
  if (body.payment_terms !== undefined) {
    patch.payment_terms = optionalString(body, "payment_terms")
  }
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active)
  Object.assign(patch, parseLocationScope(body))
  if (!Object.keys(patch).length) throw new AppError("No fields to update", 400)
  return patch
}
