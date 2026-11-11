export const name = "20261129120000-transfer-loss-note"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    { replacements: [table, column] }
  )
  return rows.length > 0
}

/** stock_transfer_items.loss_reason_note: why part of what was sent did not arrive (received_qty < qty). */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (!(await hasColumn(sequelize, "stock_transfer_items", "loss_reason_note"))) {
    await sequelize.query("ALTER TABLE stock_transfer_items ADD COLUMN loss_reason_note TEXT NULL")
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "stock_transfer_items", "loss_reason_note")) {
    await sequelize.query("ALTER TABLE stock_transfer_items DROP COLUMN loss_reason_note")
  }
}
