export const name = "20261030120000-transfer-received-qty"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows.length > 0
}

/**
 * stock_transfers.received_qty: what arrived at the destination (partial receive — less than
 * qty means some was broken / lost on the way). Completed transfers received everything.
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "stock_transfers", "received_qty")) return
  await sequelize.query("ALTER TABLE stock_transfers ADD COLUMN received_qty DECIMAL(12,4) NULL AFTER qty")
  await sequelize.query("UPDATE stock_transfers SET received_qty = qty WHERE status = 'completed'")
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "stock_transfers", "received_qty")) {
    await sequelize.query("ALTER TABLE stock_transfers DROP COLUMN received_qty")
  }
}
