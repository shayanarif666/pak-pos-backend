import { Op } from "sequelize"
import { AuditLog } from "./auditLog.model.js"
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
    location_id: json.location_id,
    location_number: json.location_id_int,
    device_id: json.device_id,
    actor_type: json.actor_type,
    user_id: json.user_id,
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
  if (query.from) created_at[Op.gte] = new Date(query.from)
  if (query.to) created_at[Op.lte] = new Date(query.to)
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

export async function listStoreAudit(actor, query = {}) {
  const where = listWhere(query, { store_id: actor.store_id })
  if (actor.role === "manager") where.location_id = actor.location_id
  const rows = await AuditLog.findAll({
    where,
    order: [["created_at", "DESC"]],
  })
  return rows.map(publicAudit)
}

export async function listPlatformAudit(actor, query = {}) {
  if (actor.role !== "superadmin") {
    throw new ForbiddenError("Super Admin only")
  }
  const extra = {}
  if (query.store_id) extra.store_id = query.store_id
  const rows = await AuditLog.findAll({
    where: listWhere(query, extra),
    order: [["created_at", "DESC"]],
    limit: Number(query.limit) > 0 ? Math.min(Number(query.limit), 500) : 200,
  })
  return rows.map(publicAudit)
}
