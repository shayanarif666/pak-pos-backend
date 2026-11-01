export const name = "20261106120000-variant-taxes"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows.length > 0
}

// A variant's own taxes (on top of its parent product's). The variant's taxes column holds both
// together; variant_taxes keeps its own part so a change to the parent's taxes can be applied.
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (!(await hasColumn(sequelize, "products", "variant_taxes"))) {
    await sequelize.query("ALTER TABLE products ADD COLUMN variant_taxes JSON NULL AFTER has_variants")
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "products", "variant_taxes")) {
    await sequelize.query("ALTER TABLE products DROP COLUMN variant_taxes")
  }
}
