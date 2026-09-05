import { UniqueConstraintError } from "sequelize"
import { Plan } from "./plan.model.js"
import { writeAudit } from "../../shared/utils/audit.util.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

export function listPlans() {
  return Plan.findAll({
    where: { is_active: true },
    order: [["price_pkr", "ASC"]],
  })
}

export async function getPlanById(id) {
  const plan = await Plan.findByPk(id)
  if (!plan) throw new NotFoundError("Plan not found")
  return plan
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
    after_data: plan.toJSON ? plan.toJSON() : plan,
  })
}

export async function upsertPlan(actor, fields) {
  const existing = await Plan.findOne({ where: { code: fields.code } })
  if (existing) {
    const before = existing.toJSON()
    await existing.update(fields)
    await auditPlan(actor, "update", existing, before)
    return { plan: existing, created: false }
  }

  try {
    const plan = await Plan.create(fields)
    await auditPlan(actor, "create", plan, null)
    return { plan, created: true }
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new ConflictError("Plan code already exists")
    }
    throw err
  }
}

export async function updatePlan(actor, id, fields) {
  const plan = await getPlanById(id)
  const before = plan.toJSON()
  await plan.update(fields)
  await auditPlan(actor, "update", plan, before)
  return plan
}

export async function deletePlan(actor, id) {
  const { Store } = await import("../stores/store.model.js")
  const plan = await getPlanById(id)
  const inUse = await Store.count({ where: { plan_id: plan.id } })
  if (inUse) {
    throw new ConflictError("Plan is assigned to one or more stores")
  }
  const before = plan.toJSON()
  await plan.destroy()
  await auditPlan(actor, "delete", { id: before.id, code: before.code, toJSON: () => before }, before)
  return { id: before.id, code: before.code }
}
