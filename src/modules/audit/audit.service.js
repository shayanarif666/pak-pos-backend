import { Op } from "sequelize"
import { AuditLog } from "./auditLog.model.js"
import { Store } from "../stores/store.model.js"
import { Location } from "../locations/location.model.js"
import { User } from "../auth/user.model.js"
import { redactAuditPayload } from "../../shared/utils/audit.util.js"
import { AUDIT_ACTION } from "../../db/enums.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"

function publicAudit(row) {
  const json = row.toJSON ? row.toJSON() : row
  return {
    id: json.id,
    store_id: json.store_id,
    store_number: json.store_id_int,
    store_name: json.Store?.name || json.store_name || null,
    location_id: json.location_id,
    location_number: json.location_id_int,
    location_name: json.Location?.name || json.location_name || null,
    device_id: json.device_id,
    actor_type: json.actor_type,
    user_id: json.user_id,
    user_name: json.User?.name || json.user_name || null,
    user_email: json.User?.email || json.user_email || null,
    action: json.action,
    entity_type: json.entity_type,
    entity_id: json.entity_id,
    before_data: redactAuditPayload(json.before_data),
    after_data: redactAuditPayload(json.after_data),
    channel: json.channel,
    ip_address: json.ip_address,
    user_agent: json.user_agent,
    note: json.note,
    created_at: json.created_at,
  }
}

function dateWhere(query) {
  if (!query.from && !query.to) return null
  const created_at = {}
  if (query.from) {
    const raw = String(query.from).trim()
    created_at[Op.gte] = /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(`${raw}T00:00:00.000Z`)
      : new Date(raw)
  }
  if (query.to) {
    const raw = String(query.to).trim()
    created_at[Op.lte] = /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(`${raw}T23:59:59.999Z`)
      : new Date(raw)
  }
  return created_at
}

function listWhere(query = {}, extra = {}) {
  const where = { ...extra }
  if (query.action) {
    if (!AUDIT_ACTION.includes(query.action)) {
      throw new AppError("Invalid audit action", 400)
    }
    where.action = query.action
  }
  if (query.entity_type) where.entity_type = query.entity_type
  if (query.user_id) where.user_id = query.user_id
  if (query.location_id) where.location_id = query.location_id
  const created_at = dateWhere(query)
  if (created_at) where.created_at = created_at
  return where
}

function auditIncludes({ withStore = false } = {}) {
  const include = [
    { model: Location, attributes: ["id", "name"], required: false },
    { model: User, attributes: ["id", "name", "email"], required: false },
  ]
  if (withStore) {
    include.unshift({ model: Store, attributes: ["id", "name", "slug"], required: false })
  }
  return include
}

export async function listStoreAudit(actor, query = {}) {
  if (!actor?.store_id) throw new ForbiddenError("No store on this account")
  const where = listWhere(query, { store_id: actor.store_id })
  // Managers are locked to their assigned location (query cannot widen scope).
  if (actor.role === "manager") {
    if (!actor.location_id) return []
    where.location_id = actor.location_id
  }
  const limit = Number(query.limit) > 0 ? Math.min(Number(query.limit), 500) : 200
  const rows = await AuditLog.findAll({
    where,
    include: auditIncludes(),
    order: [["created_at", "DESC"]],
    limit,
  })
  return rows.map(publicAudit)
}

export async function listPlatformAudit(actor, query = {}) {
  if (actor.role !== "superadmin") {
    throw new ForbiddenError("Super Admin only")
  }
  const extra = {}
  if (query.store_id) extra.store_id = query.store_id
  const limit = Number(query.limit) > 0 ? Math.min(Number(query.limit), 500) : 200
  const rows = await AuditLog.findAll({
    where: listWhere(query, extra),
    include: auditIncludes({ withStore: true }),
    order: [["created_at", "DESC"]],
    limit,
  })
  return rows.map(publicAudit)
}
