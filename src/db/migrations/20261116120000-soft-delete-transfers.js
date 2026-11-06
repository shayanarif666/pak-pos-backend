export const name = "20261116120000-soft-delete-transfers"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    { replacements: [table, column] }
  )
  return rows.length > 0
}

// Soft delete of a stock transfer (dashboard: Stock Transfers → Delete): the row and its lines stay,
// but no list, report or POS sync shows it. Only a transfer whose stock has not moved yet is deleted.
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (!(await hasColumn(sequelize, "stock_transfers", "deleted_at"))) {
    await sequelize.query("ALTER TABLE `stock_transfers` ADD COLUMN `deleted_at` DATETIME(6) NULL DEFAULT NULL")
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "stock_transfers", "deleted_at")) {
    await sequelize.query("ALTER TABLE `stock_transfers` DROP COLUMN `deleted_at`")
  }
}
