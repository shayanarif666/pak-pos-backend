export const name = "20261029120000-refund-payments"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows.length > 0
}

/**
 * order_refunds.payments: how a refund was paid back, per method the sale was paid with
 * ([{ method, bill_share, payment_tax_percent, payment_tax_amount, amount }]; method "credit"
 * = taken off the customer's udhaar). Older refunds (null) were all paid back in cash.
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "order_refunds", "payments")) return
  await sequelize.query("ALTER TABLE order_refunds ADD COLUMN payments JSON NULL AFTER tax_amount")
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "order_refunds", "payments")) {
    await sequelize.query("ALTER TABLE order_refunds DROP COLUMN payments")
  }
}
