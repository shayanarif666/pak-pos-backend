import { registerModels } from "../registerModels.js"
import { sequelize } from "../sequelize.js"
import { seedPlans } from "./plans.seeder.js"

async function run() {
  registerModels()
  await sequelize.authenticate()
  const codes = await seedPlans()
  console.log("Plans seeded:", codes.join(", "))
  await sequelize.close()
}

run().catch(async (err) => {
  console.error(err)
  await sequelize.close()
  process.exit(1)
})
