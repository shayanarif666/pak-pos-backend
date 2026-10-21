import { randomUUID } from "crypto"
import { Plan } from "../../modules/plans/plan.model.js"
import { nextPlanNumber } from "../../shared/utils/counter.util.js"

const PLANS = [
  {
    code: "package_1",
    type: "monthly",
    name: "Package 1",
    price_pkr: 2500,
    max_devices: 1,
    max_locations: 1,
    features: ["1 POS device", "1 location", "Basic sales reports"],
  },
  {
    code: "package_2",
    type: "monthly",
    name: "Package 2",
    price_pkr: 4000,
    max_devices: 3,
    max_locations: 1,
    features: [
      "offline_enabled",
      "pin_override_enabled",
      "approval_enabled",
      "advanced_reports",
      "backup_restore_enabled",
      "3 POS devices",
      "1 location",
    ],
  },
  {
    code: "package_3",
    type: "monthly",
    name: "Package 3",
    price_pkr: 8000,
    max_devices: 10,
    max_locations: 99,
    features: [
      "offline_enabled",
      "pin_override_enabled",
      "approval_enabled",
      "advanced_reports",
      "backup_restore_enabled",
      "multi_branch_enabled",
      "has_dedicated_am",
      "10 POS devices",
      "Multi-location",
    ],
  },
]

export async function seedPlans() {
  const created = []

  for (const plan of PLANS) {
    const row = await Plan.findOne({ where: { code: plan.code } })
    if (!row) {
      // plan_number is required; take it from the same counter POST /plans uses.
      await Plan.create({
        id: randomUUID(),
        ...plan,
        plan_number: await nextPlanNumber(),
        is_active: true,
      })
      created.push(plan.code)
      continue
    }
    const features = row.features
    if (!Array.isArray(features) || !features.length) {
      await row.update(plan)
    }
    created.push(row.code)
  }

  return created
}
