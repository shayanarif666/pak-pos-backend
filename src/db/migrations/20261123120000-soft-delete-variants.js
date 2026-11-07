export const name = "20261123120000-soft-delete-variants"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    { replacements: [table, column] }
  )
  return rows.length > 0
}

/*
 * products.deleted_at: a variant that was deleted (soft delete). It leaves its product's variant
 * list, the forms, the stock lists and the POS; its stock rows, movements and sales stay as they
 * were (history still names it). Its variant number is not used again.
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (!(await hasColumn(sequelize, "products", "deleted_at"))) {
    await sequelize.query("ALTER TABLE products ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL")
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "products", "deleted_at")) {
    await sequelize.query("ALTER TABLE products DROP COLUMN deleted_at")
  }
}
