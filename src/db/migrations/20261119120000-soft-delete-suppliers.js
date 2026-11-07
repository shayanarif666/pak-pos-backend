export const name = "20261119120000-soft-delete-suppliers"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    { replacements: [table, column] }
  )
  return rows.length > 0
}

// Soft delete of a supplier (dashboard: Suppliers → Delete): it leaves the supplier list and new
// stock movements; movements and ledger entries that named it still show its name.
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (!(await hasColumn(sequelize, "suppliers", "deleted_at"))) {
    await sequelize.query("ALTER TABLE `suppliers` ADD COLUMN `deleted_at` DATETIME(6) NULL DEFAULT NULL")
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "suppliers", "deleted_at")) {
    await sequelize.query("ALTER TABLE `suppliers` DROP COLUMN `deleted_at`")
  }
}
