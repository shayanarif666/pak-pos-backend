export const name = "20261201120000-order-pricing-v2"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    { replacements: [table, column] }
  )
  return rows.length > 0
}

const COLUMNS = [
  // The order as the till priced it: no tax / no discount on the whole order, the order discount
  // ({ id, name, type, value }) and the bundles used ([{ id, name, reward_type, value }]).
  ["orders", "tax_exempt", "TINYINT(1) NOT NULL DEFAULT 0"],
  ["orders", "discount_exempt", "TINYINT(1) NOT NULL DEFAULT 0"],
  ["orders", "order_discount", "JSON NULL"],
  ["orders", "bundles", "JSON NULL"],
  // Every discount of a line as sent: [{ id, level, name, type, value, amount }]; the bundle the line belongs to.
  ["order_items", "discount_entries", "JSON NULL"],
  ["order_items", "bundle_id", "INT NULL"],
  ["order_items", "bundle_role", "VARCHAR(16) NULL"],
]

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const [table, column, type] of COLUMNS) {
    if (!(await hasColumn(sequelize, table, column))) await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const [table, column] of [...COLUMNS].reverse()) {
    if (await hasColumn(sequelize, table, column)) await sequelize.query(`ALTER TABLE ${table} DROP COLUMN ${column}`)
  }
}
