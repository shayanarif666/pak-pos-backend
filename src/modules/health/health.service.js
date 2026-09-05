import { sequelize } from "../../db/sequelize.js"

export async function checkHealth() {
  await sequelize.query("SELECT 1")
  return { ok: true, db: true }
}
