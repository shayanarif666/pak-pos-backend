import { randomUUID } from "crypto"
import { Plan } from "../../modules/plans/plan.model.js"

const PLANS = [
  {
    code: "package_1",
    name: "Package 1",
    price_pkr: 2500,
    max_devices: 1,
    max_locations: 1,
    offline_enabled: false,
    pin_override_enabled: false,
    approval_enabled: false,
    advanced_reports: false,
    backup_restore_enabled: false,
    multi_branch_enabled: false,
    has_dedicated_am: false,
  },
  {
    code: "package_2",
    name: "Package 2",
    price_pkr: 4000,
    max_devices: 3,
    max_locations: 1,
    offline_enabled: true,
    pin_override_enabled: true,
    approval_enabled: true,
    advanced_reports: true,
    backup_restore_enabled: true,
    multi_branch_enabled: false,
    has_dedicated_am: false,
  },
  {
    code: "package_3",
    name: "Package 3",
    price_pkr: 8000,
    max_devices: 10,
    max_locations: 99,
    offline_enabled: true,
    pin_override_enabled: true,
    approval_enabled: true,
    advanced_reports: true,
    backup_restore_enabled: true,
    multi_branch_enabled: true,
    has_dedicated_am: true,
  },
]

export async function seedPlans() {
  const created = []

  for (const plan of PLANS) {
    const [row, wasCreated] = await Plan.findOrCreate({
      where: { code: plan.code },
      defaults: { id: randomUUID(), ...plan, is_active: true },
    })
    if (!wasCreated) {
      await row.update(plan)
    }
    created.push(row.code)
  }

  return created
}
