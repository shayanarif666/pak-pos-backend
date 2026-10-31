export const name = "20261101120000-order-status-v2"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows.length > 0
}

async function columnType(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows[0]?.COLUMN_TYPE || ""
}

const ORDER_ITEM_COLUMNS = [
  ["product_discount", "JSON NULL AFTER discount_source"],
  ["category_discount", "JSON NULL AFTER product_discount"],
  ["category_tax_name", "VARCHAR(255) NULL AFTER category_tax_value"],
]

/**
 * orders.order_status + 'partial_refunded' (some items refunded) and orders.payment_status +
 * 'partial' (paid less than the total, the rest udhaar). Orders already partly refunded or on
 * udhaar get the new statuses. order_items keep the product / category discount that priced
 * the line (name, type, value, amount) and the category tax's name, as they were at the sale.
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (!(await columnType(sequelize, "orders", "order_status")).includes("partial_refunded")) {
    await sequelize.query(
      "ALTER TABLE orders MODIFY order_status ENUM('pending','completed','partial_refunded','voided','cancelled','refunded') NOT NULL DEFAULT 'pending'"
    )
    await sequelize.query(`
      UPDATE orders o SET o.order_status = 'partial_refunded'
      WHERE o.order_status = 'completed'
        AND EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.refunded_qty > 0)
    `)
  }
  if (!(await columnType(sequelize, "orders", "payment_status")).includes("partial")) {
    await sequelize.query(
      "ALTER TABLE orders MODIFY payment_status ENUM('pending','paid','partial','failed','refunded') NOT NULL DEFAULT 'pending'"
    )
    await sequelize.query(`
      UPDATE orders o SET o.payment_status = 'partial'
      WHERE o.payment_status = 'paid' AND o.channel = 'pos'
        AND o.total_amount - (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.order_id = o.id AND p.status = 'success') > 0.01
    `)
  }
  for (const [column, definition] of ORDER_ITEM_COLUMNS) {
    if (!(await hasColumn(sequelize, "order_items", column))) {
      await sequelize.query(`ALTER TABLE order_items ADD COLUMN ${column} ${definition}`)
    }
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  await sequelize.query("UPDATE orders SET order_status = 'completed' WHERE order_status = 'partial_refunded'")
  await sequelize.query("UPDATE orders SET payment_status = 'paid' WHERE payment_status = 'partial'")
  await sequelize.query(
    "ALTER TABLE orders MODIFY order_status ENUM('pending','completed','voided','cancelled','refunded') NOT NULL DEFAULT 'pending'"
  )
  await sequelize.query(
    "ALTER TABLE orders MODIFY payment_status ENUM('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending'"
  )
  for (const [column] of [...ORDER_ITEM_COLUMNS].reverse()) {
    if (await hasColumn(sequelize, "order_items", column)) {
      await sequelize.query(`ALTER TABLE order_items DROP COLUMN ${column}`)
    }
  }
}
