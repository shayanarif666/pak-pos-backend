import { AuditLog } from "../../modules/audit/auditLog.model.js"

const SENSITIVE_KEY =
  /password|passwd|pin|license_key|refresh_token|access_token|verify_token|reset_token|secret|authorization|token/i

export function redactAuditPayload(value) {
  if (value == null) return value
  if (Array.isArray(value)) return value.map(redactAuditPayload)
  if (typeof value !== "object") return value
  const out = {}
  for (const [key, child] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redactAuditPayload(child)
  }
  return out
}

export async function writeAudit(fields) {
  try {
    await AuditLog.create({
      actor_type: fields.actor_type || "user",
      action: fields.action,
      entity_type: fields.entity_type,
      entity_id: fields.entity_id || null,
      store_id: fields.store_id || null,
      store_id_int: fields.store_id_int ?? null,
      location_id: fields.location_id || null,
      location_id_int: fields.location_id_int ?? null,
      device_id: fields.device_id || null,
      user_id: fields.user_id || null,
      channel: fields.channel || null,
      ip_address: fields.ip_address || null,
      user_agent: fields.user_agent || null,
      note: fields.note || null,
      before_data: fields.before_data
        ? redactAuditPayload(fields.before_data)
        : null,
      after_data: fields.after_data ? redactAuditPayload(fields.after_data) : null,
    })
  } catch {
    // Auth must still succeed if the audit row cannot be written.
  }
}
