export const name = "20261130120000-variant-discount"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    { replacements: [table, column] }
  )
  return rows.length > 0
}

/*
 * A variant can have a discount of its own (the discount columns of its product row). Without one it takes
 * its product's discount, unless uses_product_discount is 0 (the variant opted out). The flag only means
 * something on a variant.
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (!(await hasColumn(sequelize, "products", "uses_product_discount"))) {
    await sequelize.query("ALTER TABLE products ADD COLUMN uses_product_discount TINYINT(1) NOT NULL DEFAULT 1")
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "products", "uses_product_discount")) {
    await sequelize.query("ALTER TABLE products DROP COLUMN uses_product_discount")
  }
}
