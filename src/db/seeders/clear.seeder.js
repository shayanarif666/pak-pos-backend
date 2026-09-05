import { sequelize } from "../sequelize.js"
import { clearAllBusinessTables } from "../clearData.js"

async function run() {
  await sequelize.authenticate()
  const cleared = await clearAllBusinessTables(sequelize)
  console.log("Cleared tables:", cleared.join(", ") || "(none)")
  await sequelize.close()
}

run().catch(async (err) => {
  console.error(err)
  await sequelize.close()
  process.exit(1)
})
