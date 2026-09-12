import { randomUUID } from "crypto"
import { Plan } from "../../modules/plans/plan.model.js"

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
    const [row, wasCreated] = await Plan.findOrCreate({
      where: { code: plan.code },
      defaults: { id: randomUUID(), ...plan, is_active: true },
    })
    if (wasCreated) {
      created.push(row.code)
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
