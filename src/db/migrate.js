import { sequelize } from "./sequelize.js"
import { registerModels } from "./registerModels.js"
import { seedPlans } from "./seeders/plans.seeder.js"
import * as initSchema from "./migrations/20260830120000-init-schema.js"
import * as storeDefaultLocation from "./migrations/20260830180000-stores-default-location.js"
import * as posStaffRoleManager from "./migrations/20260830190000-pos-staff-role-manager.js"
import * as schemaV2 from "./migrations/20260904120000-schema-v2.js"
import * as licensePendingDevice from "./migrations/20260905180000-license-pending-device.js"
import * as orderItemRefunds from "./migrations/20260906180000-order-item-refunds.js"
import * as dropCustomerCreditFields from "./migrations/20260906210000-drop-customer-credit-fields.js"
import * as customerDebtFields from "./migrations/20260906213000-customer-debt-fields.js"
import * as categoryDiscountFields from "./migrations/20260906220000-category-discount-fields.js"
import * as orderPricingBreakdown from "./migrations/20260908120000-order-pricing-breakdown.js"
import * as planFeaturesArray from "./migrations/20260908220000-plan-features-array.js"

const migrations = [
  initSchema,
  storeDefaultLocation,
  posStaffRoleManager,
  schemaV2,
  licensePendingDevice,
  orderItemRefunds,
  dropCustomerCreditFields,
  customerDebtFields,
  categoryDiscountFields,
  orderPricingBreakdown,
  planFeaturesArray,
]

async function migrate() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS SequelizeMeta (
      name VARCHAR(255) NOT NULL,
      PRIMARY KEY (name)
    ) ENGINE=InnoDB
  `)

  const queryInterface = sequelize.getQueryInterface()

  for (const migration of migrations) {
    const [rows] = await sequelize.query(
      "SELECT name FROM SequelizeMeta WHERE name = ?",
      { replacements: [migration.name] }
    )
    if (rows.length) {
      console.log(`Already applied: ${migration.name}`)
      continue
    }

    await migration.up(queryInterface)
    await sequelize.query("INSERT INTO SequelizeMeta (name) VALUES (?)", {
      replacements: [migration.name],
    })
    console.log(`Applied: ${migration.name}`)
  }

  registerModels()
  const planCodes = await seedPlans()
  console.log("Plans seeded:", planCodes.join(", "))

  await sequelize.close()
}

migrate().catch(async (err) => {
  console.error(err)
  await sequelize.close()
  process.exit(1)
})
