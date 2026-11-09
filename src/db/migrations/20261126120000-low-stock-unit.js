export const name = "20261126120000-low-stock-unit"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    { replacements: [table, column] }
  )
  return rows.length > 0
}

/*
 * products.low_stock_unit: what a pack + loose product's low_stock_threshold counts: "pack" or "unit".
 * A pack-only product always counts packs and any other product units, whatever this says.
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (!(await hasColumn(sequelize, "products", "low_stock_unit"))) {
    await sequelize.query("ALTER TABLE products ADD COLUMN low_stock_unit VARCHAR(8) NOT NULL DEFAULT 'unit'")
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "products", "low_stock_unit")) {
    await sequelize.query("ALTER TABLE products DROP COLUMN low_stock_unit")
  }
}
