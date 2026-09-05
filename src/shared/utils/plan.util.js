import { getStorePlan } from "../../modules/stores/store.service.js"
import { ConflictError } from "../errors/ConflictError.js"
import { ForbiddenError } from "../errors/ForbiddenError.js"
import { AppError } from "../errors/AppError.js"

const FLAG_MESSAGES = {
  approval_enabled: "Approvals require Package 2 or 3",
  pin_override_enabled: "PIN override requires Package 2 or 3",
  backup_restore_enabled: "Backup is not enabled on this plan",
  multi_branch_enabled: "Stock transfers require Package 3",
  offline_enabled: "Offline sync requires Package 2 or 3",
  advanced_reports: "Advanced reports require Package 2 or 3",
}

const ALIASES = {
  approval: "approval_enabled",
  pin_override: "pin_override_enabled",
  backup: "backup_restore_enabled",
  multi_branch: "multi_branch_enabled",
  offline: "offline_enabled",
  locations: "max_locations",
  devices: "max_devices",
}

function resolveFeature(feature) {
  return ALIASES[feature] || feature
}

export async function loadPlan(store) {
  return getStorePlan(store)
}

export async function hasPlanFeature(store, feature) {
  const plan = await loadPlan(store)
  const key = resolveFeature(feature)
  return { plan, enabled: Boolean(plan[key]) }
}

export async function assertPlan(store, feature, opts = {}) {
  const plan = await loadPlan(store)
  const key = resolveFeature(feature)

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

  const message = FLAG_MESSAGES[key]
  if (!message) throw new AppError(`Unknown plan feature: ${feature}`, 500)
  if (!plan[key]) throw new ForbiddenError(message)
  return plan
}
