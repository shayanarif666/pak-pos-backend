export const name = "20261031120000-order-item-offers"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows.length > 0
}

const ORDER_ITEM_COLUMNS = [
  ["category_id", "CHAR(36) NULL AFTER custom_category"],
  ["category_name", "VARCHAR(255) NULL AFTER category_id"],
  ["discount_source", "VARCHAR(32) NULL AFTER discount_amount"],
  ["offer_id", "CHAR(36) NULL AFTER discount_source"],
  ["offers", "JSON NULL AFTER offer_id"],
  ["free_qty", "DECIMAL(12,4) NOT NULL DEFAULT 0 AFTER offers"],
]

/**
 * What priced each sold line, kept as it was at the sale: its category (id + name), where the
 * discount came from (product / category / offer…), the offer(s) applied (snapshot list) and the
 * BOGO free qty. orders.offer_exempt: the order was rung up without offers.
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const [column, definition] of ORDER_ITEM_COLUMNS) {
    if (!(await hasColumn(sequelize, "order_items", column))) {
      await sequelize.query(`ALTER TABLE order_items ADD COLUMN ${column} ${definition}`)
    }
  }
  if (!(await hasColumn(sequelize, "orders", "offer_exempt"))) {
    await sequelize.query("ALTER TABLE orders ADD COLUMN offer_exempt TINYINT(1) NOT NULL DEFAULT 0")
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const [column] of [...ORDER_ITEM_COLUMNS].reverse()) {
    if (await hasColumn(sequelize, "order_items", column)) {
      await sequelize.query(`ALTER TABLE order_items DROP COLUMN ${column}`)
    }
  }
  if (await hasColumn(sequelize, "orders", "offer_exempt")) {
    await sequelize.query("ALTER TABLE orders DROP COLUMN offer_exempt")
  }
}
