export const name = "20261205120000-line-gross-total"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    { replacements: [table, column] }
  )
  return rows.length > 0
}

/*
 * A sale / refund line's gross and total as the till sent them (the server no longer works them out):
 * order_items.gross_amount / total and order_refund_items.gross_amount / total. Null on older rows
 * (their replies keep showing price × qty and subtotal + tax).
 */
const COLUMNS = [
  ["order_items", "gross_amount", "subtotal"],
  ["order_items", "total", "tax_amount"],
  ["order_refund_items", "gross_amount", "subtotal"],
  ["order_refund_items", "total", "tax_amount"],
]

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const [table, column, after] of COLUMNS) {
    if (!(await hasColumn(sequelize, table, column))) {
      await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} DECIMAL(12, 2) NULL AFTER ${after}`)
    }
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const [table, column] of COLUMNS) {
    if (await hasColumn(sequelize, table, column)) await sequelize.query(`ALTER TABLE ${table} DROP COLUMN ${column}`)
  }
}
