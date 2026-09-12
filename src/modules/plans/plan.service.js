import { UniqueConstraintError } from "sequelize"
import { Plan } from "./plan.model.js"
import { writeAudit } from "../../shared/utils/audit.util.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

const FEATURE_ALIASES = {
  approval: "approval_enabled",
  pin_override: "pin_override_enabled",
  backup: "backup_restore_enabled",
  multi_branch: "multi_branch_enabled",
  offline: "offline_enabled",
  locations: "max_locations",
  devices: "max_devices",
}

export function planFeatures(plan) {
  const raw = plan?.features
  if (Array.isArray(raw)) return raw.filter((item) => typeof item === "string" && item.trim())
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed)
        ? parsed.filter((item) => typeof item === "string" && item.trim())
        : []
    } catch {
      return []
    }
  }
  return []
}

export function resolveFeatureKey(feature) {
  return FEATURE_ALIASES[feature] || feature
}

export function planHasFeature(plan, feature) {
  const key = resolveFeatureKey(feature)
  if (key === "max_locations" || key === "max_devices") return true
  const wanted = String(key).toLowerCase()
  return planFeatures(plan).some((item) => item.toLowerCase() === wanted)
}

export function publicPlan(plan) {
  if (!plan) return null
  const json = plan.toJSON ? plan.toJSON() : plan
  return {
    id: json.id,
    code: json.code,
    type: json.type || "monthly",
    name: json.name,
    price_pkr: Number(json.price_pkr),
    max_devices: json.max_devices,
    max_locations: json.max_locations,
    features: planFeatures(json),
    is_active: json.is_active,
    created_at: json.created_at,
    updated_at: json.updated_at,
  }
}

export async function listPlans() {
  const rows = await Plan.findAll({
    where: { is_active: true },
    order: [["price_pkr", "ASC"]],
  })
  return rows.map(publicPlan)
}

export async function getPlanById(id) {
  const plan = await Plan.findByPk(id)
  if (!plan) throw new NotFoundError("Plan not found")
  return plan
}

export async function getPlanView(id) {
  return publicPlan(await getPlanById(id))
}

async function auditPlan(actor, action, plan, before_data) {
  await writeAudit({
    action,
    entity_type: "plans",
    entity_id: plan.id,
    user_id: actor?.id || null,
    channel: "dashboard",
    note: plan.code,
    before_data,
    after_data: publicPlan(plan),
  })
}

export async function upsertPlan(actor, fields) {
  const existing = await Plan.findOne({ where: { code: fields.code } })
  if (existing) {
    const before = publicPlan(existing)
    await existing.update(fields)
    await auditPlan(actor, "update", existing, before)
    return { plan: publicPlan(existing), created: false }
  }

  try {
    const plan = await Plan.create(fields)
    await auditPlan(actor, "create", plan, null)
    return { plan: publicPlan(plan), created: true }
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new ConflictError("Plan code already exists")
    }
    throw err
  }
}

export async function updatePlan(actor, id, fields) {
  const plan = await getPlanById(id)
  const before = publicPlan(plan)
  await plan.update(fields)
  await auditPlan(actor, "update", plan, before)
  return publicPlan(plan)
}

export async function deletePlan(actor, id) {
  const { Store } = await import("../stores/store.model.js")
  const plan = await getPlanById(id)
  const inUse = await Store.count({ where: { plan_id: plan.id } })
  if (inUse) {
    throw new ConflictError("Plan is assigned to one or more stores")
  }
  const before = publicPlan(plan)
  await auditPlan(actor, "delete", plan, before)
  await plan.destroy()
  return { id: before.id, code: before.code }
}
