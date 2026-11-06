export const name = "20261117120000-soft-delete-offers-locations"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    { replacements: [table, column] }
  )
  return rows.length > 0
}

// Soft delete from the dashboard:
// - offers.deleted_at: a discount leaves the list and the POS (paranoid model); sales made with it
//   keep pointing at it.
// - locations.deleted_at: a branch leaves the location list and the plan count; orders, stock
//   movements and staff history still show its name (the model is not paranoid).
const TABLES = ["offers", "locations"]

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const table of TABLES) {
    if (await hasColumn(sequelize, table, "deleted_at")) continue
    await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`deleted_at\` DATETIME(6) NULL DEFAULT NULL`)
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const table of TABLES) {
    if (await hasColumn(sequelize, table, "deleted_at")) {
      await sequelize.query(`ALTER TABLE \`${table}\` DROP COLUMN \`deleted_at\``)
    }
  }
}
