export const name = "20261025130000-sales-tax-toggle"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows.length > 0
}

/**
 * Sales tax gets its own on / off switch (like payment-method GST) and a default rate of 18%.
 * Existing stores keep what they charge today: a store that had a sales tax rate stays on with
 * it; a store without one gets 18% stored but switched off, so its bills don't change until the
 * owner turns it on.
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "stores", "sales_tax_enabled")) return
  await sequelize.query(
    "ALTER TABLE stores ADD COLUMN sales_tax_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER sales_tax_rate"
  )
  await sequelize.query(`
    UPDATE stores
    SET sales_tax_enabled = CASE WHEN sales_tax_rate IS NOT NULL AND sales_tax_rate > 0 THEN 1 ELSE 0 END,
        sales_tax_rate = CASE WHEN sales_tax_rate IS NULL OR sales_tax_rate = 0 THEN 18 ELSE sales_tax_rate END
  `)
  await sequelize.query("ALTER TABLE stores MODIFY COLUMN sales_tax_rate DECIMAL(5,2) NULL DEFAULT 18")
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "stores", "sales_tax_enabled")) {
    await sequelize.query("ALTER TABLE stores DROP COLUMN sales_tax_enabled")
  }
}
