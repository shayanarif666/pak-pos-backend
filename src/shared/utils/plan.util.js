import { getStorePlan } from "../../modules/stores/store.service.js"
import { planHasFeature, resolveFeatureKey } from "../../modules/plans/plan.service.js"
import { ConflictError } from "../errors/ConflictError.js"
import { ForbiddenError } from "../errors/ForbiddenError.js"

const FLAG_MESSAGES = {
  approval_enabled: "Approvals are not enabled on this plan",
  pin_override_enabled: "PIN override is not enabled on this plan",
  backup_restore_enabled: "Backup is not enabled on this plan",
  multi_branch_enabled: "Stock transfers are not enabled on this plan",
  offline_enabled: "Offline sync is not enabled on this plan",
  advanced_reports: "Advanced reports are not enabled on this plan",
}

export async function loadPlan(store) {
  return getStorePlan(store)
}

export async function hasPlanFeature(store, feature) {
  const plan = await loadPlan(store)
  return { plan, enabled: planHasFeature(plan, feature) }
}

export async function assertPlan(store, feature, opts = {}) {
  const plan = await loadPlan(store)
  const key = resolveFeatureKey(feature)

  if (key === "max_locations") {
    const count = Number(opts.count || 0)
    if (count >= plan.max_locations) {
      throw new ConflictError(
        `Plan allows at most ${plan.max_locations} location(s)`
      )
    }
    return plan
  }

  if (key === "max_devices") {
    const count = Number(opts.count || 0)
    const extra = Number(opts.extra || 0)
    if (count + extra > plan.max_devices) {
      throw new ConflictError(`Plan allows at most ${plan.max_devices} device(s)`)
    }
    return plan
  }

  if (!planHasFeature(plan, key)) {
    throw new ForbiddenError(FLAG_MESSAGES[key] || `${key} is not enabled on this plan`)
  }
  return plan
}
