export const name = "20261114120000-soft-delete-staff-sessions-batches"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    { replacements: [table, column] }
  )
  return rows.length > 0
}

// Soft delete: a deleted staff member, attendance session or batch keeps its row (history,
// orders and reports still point at it); deleted_at hides it from lists and new work.
const TABLES = ["users", "staff_sessions", "register_sessions"]

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const table of TABLES) {
    if (await hasColumn(sequelize, table, "deleted_at")) continue
    await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN deleted_at DATETIME(6) NULL DEFAULT NULL`)
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const table of TABLES) {
    if (await hasColumn(sequelize, table, "deleted_at")) {
      await sequelize.query(`ALTER TABLE \`${table}\` DROP COLUMN deleted_at`)
    }
  }
}
