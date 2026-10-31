export const name = "20261102120000-number-columns"

async function hasTable(sequelize, table) {
  const [rows] = await sequelize.query(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    { replacements: [table] }
  )
  return rows.length > 0
}

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows.length > 0
}

// [table, column, numbered within (null = the whole table), NOT NULL]
const NUMBER_COLUMNS = [
  ["plans", "plan_number", null, true],
  ["users", "user_number", "store_id", false],
  ["pos_devices", "device_number", "store_id", true],
  ["register_sessions", "session_number", "store_id", true],
  ["categories", "category_number", "store_id", true],
  ["products", "product_number", "store_id", true],
  ["suppliers", "supplier_number", "store_id", true],
  ["supplier_ledger", "ledger_number", "store_id", true],
  ["supplier_locations", "supplier_location_number", "store_id", true],
  ["stock_movements", "movement_number", "store_id", true],
  ["stock_transfers", "transfer_number", "store_id", true],
  ["customers", "customer_number", "store_id", true],
  ["offers", "offer_number", "store_id", true],
  ["order_items", "item_number", "order_id", true],
  ["order_refunds", "refund_number", "store_id", true],
  ["order_refund_items", "item_number", "refund_id", true],
]

/**
 * The short numbers (1, 2, 3… per store / per order) the POS shows. Databases that grew with the
 * app already have them (added by hand before migrations covered them); a fresh database did
 * not, so the app could not start on it. Each missing column is added, existing rows numbered
 * in the order they were created, then made NOT NULL where the model requires it.
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const [table, column, within, notNull] of NUMBER_COLUMNS) {
    if (!(await hasTable(sequelize, table))) continue
    if (await hasColumn(sequelize, table, column)) continue
    await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` INT NULL`)
    const partition = within && (await hasColumn(sequelize, table, within)) ? `PARTITION BY \`${within}\`` : ""
    const order = (await hasColumn(sequelize, table, "created_at")) ? "created_at, id" : "id"
    await sequelize.query(`
      UPDATE \`${table}\` t
      JOIN (SELECT id, ROW_NUMBER() OVER (${partition} ORDER BY ${order}) AS n FROM \`${table}\`) numbered
        ON numbered.id = t.id
      SET t.\`${column}\` = numbered.n
    `)
    if (notNull) await sequelize.query(`ALTER TABLE \`${table}\` MODIFY \`${column}\` INT NOT NULL`)
  }
}

export async function down() {
  // Kept: other migrations and every reply depend on these numbers.
}
