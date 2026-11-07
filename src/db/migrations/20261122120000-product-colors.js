export const name = "20261122120000-product-colors"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    { replacements: [table, column] }
  )
  return rows.length > 0
}

/*
 * products.colors: the colours a product (or a variant — variants are product rows too) comes in,
 * as hex codes: ["#E11D48", "#2563EB"]. Null / [] = none set.
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (!(await hasColumn(sequelize, "products", "colors"))) {
    await sequelize.query("ALTER TABLE products ADD COLUMN colors JSON NULL")
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "products", "colors")) {
    await sequelize.query("ALTER TABLE products DROP COLUMN colors")
  }
}
