export const name = "20261202120000-refund-order-discount"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    { replacements: [table, column] }
  )
  return rows.length > 0
}

/*
 * A refund gives back its share of the order discount: order_refunds.order_discount_amount (the lines' discounts
 * are in discount_amount).
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (!(await hasColumn(sequelize, "order_refunds", "order_discount_amount"))) {
    await sequelize.query("ALTER TABLE order_refunds ADD COLUMN order_discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0")
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "order_refunds", "order_discount_amount")) {
    await sequelize.query("ALTER TABLE order_refunds DROP COLUMN order_discount_amount")
  }
}
