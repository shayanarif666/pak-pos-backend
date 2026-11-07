export const name = "20261118120000-pos-figures-orders-refunds"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    { replacements: [table, column] }
  )
  return rows.length > 0
}

// The POS works out every figure of a sale and of a refund; these keep them as it sent them:
// - orders.local_receipt_number: the number printed on the till's (offline) receipt.
// - order_items.line_taxes: the line's taxes [{ level, name, rate, amount }] as sent.
// - order_refunds: the till's id (no double refund on a retry), when it happened at the till,
//   the batch the money left from, its discount and payment surcharge totals.
// - order_refund_items: the qty's discount, its taxes as sent, and whether it went back to stock.
const COLUMNS = [
  ["orders", "local_receipt_number", "VARCHAR(64) NULL DEFAULT NULL"],
  ["order_items", "line_taxes", "JSON NULL"],
  ["order_refunds", "client_local_id", "VARCHAR(128) NULL DEFAULT NULL"],
  ["order_refunds", "refunded_at", "DATETIME(6) NULL DEFAULT NULL"],
  ["order_refunds", "register_session_id", "CHAR(36) NULL DEFAULT NULL"],
  ["order_refunds", "discount_amount", "DECIMAL(12,2) NULL DEFAULT NULL"],
  ["order_refunds", "surcharge_amount", "DECIMAL(12,2) NULL DEFAULT NULL"],
  ["order_refund_items", "discount_amount", "DECIMAL(12,2) NULL DEFAULT NULL"],
  ["order_refund_items", "line_taxes", "JSON NULL"],
  ["order_refund_items", "restocked", "TINYINT(1) NULL DEFAULT NULL"],
]

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const [table, column, type] of COLUMNS) {
    if (await hasColumn(sequelize, table, column)) continue
    await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${type}`)
  }
  // One refund per till id in a store.
  const [indexes] = await sequelize.query("SHOW INDEX FROM `order_refunds` WHERE Key_name = 'order_refunds_store_client_local_id'")
  if (!indexes.length) {
    await sequelize.query("CREATE UNIQUE INDEX `order_refunds_store_client_local_id` ON `order_refunds` (`store_id`, `client_local_id`)")
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  const [indexes] = await sequelize.query("SHOW INDEX FROM `order_refunds` WHERE Key_name = 'order_refunds_store_client_local_id'")
  if (indexes.length) await sequelize.query("DROP INDEX `order_refunds_store_client_local_id` ON `order_refunds`")
  for (const [table, column] of COLUMNS) {
    if (await hasColumn(sequelize, table, column)) {
      await sequelize.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``)
    }
  }
}
