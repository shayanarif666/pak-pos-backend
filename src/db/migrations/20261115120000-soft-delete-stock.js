export const name = "20261115120000-soft-delete-stock"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    { replacements: [table, column] }
  )
  return rows.length > 0
}

// Soft delete for stock:
// - stock_movements.deleted_at: a wrong movement is deleted (its qty taken back off the stock);
//   the row stays for the record but no list, report or total counts it.
// - product_stocks.deleted_at: a stock entry (product at a location) removed from the stock &
//   expiry list; its qty is set to 0 by an adjustment movement first. A new movement brings it back.
// - stock_movements.updated_at: when a movement was last edited.
const COLUMNS = [
  ["stock_movements", "deleted_at", "DATETIME(6) NULL DEFAULT NULL"],
  ["stock_movements", "updated_at", "DATETIME(6) NULL DEFAULT NULL"],
  ["product_stocks", "deleted_at", "DATETIME(6) NULL DEFAULT NULL"],
]

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const [table, column, type] of COLUMNS) {
    if (await hasColumn(sequelize, table, column)) continue
    await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${type}`)
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const [table, column] of COLUMNS) {
    if (await hasColumn(sequelize, table, column)) {
      await sequelize.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``)
    }
  }
}
