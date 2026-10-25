export const name = "20261027120000-refund-type"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows.length > 0
}

/**
 * order_refunds.refund_type: complete (POST .../refund/complete — the whole order) or partial
 * (some items). Older rows of an order that ended up fully refunded count as complete.
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "order_refunds", "refund_type")) return
  await sequelize.query(
    "ALTER TABLE order_refunds ADD COLUMN refund_type ENUM('complete','partial') NOT NULL DEFAULT 'partial' AFTER receipt_id"
  )
  await sequelize.query(`
    UPDATE order_refunds r JOIN orders o ON o.id = r.order_id
    SET r.refund_type = 'complete'
    WHERE o.order_status = 'refunded'
  `)
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "order_refunds", "refund_type")) {
    await sequelize.query("ALTER TABLE order_refunds DROP COLUMN refund_type")
  }
}
