export const name = "20260906180000-order-item-refunds"

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize

  const [cols] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'refunded_qty'`
  )
  if (!cols.length) {
    await sequelize.query(
      "ALTER TABLE order_items ADD COLUMN refunded_qty DECIMAL(12,4) NOT NULL DEFAULT 0 AFTER quantity"
    )
  }

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS order_refunds (
      id CHAR(36) NOT NULL,
      store_id CHAR(36) NOT NULL,
      store_id_int INT NOT NULL,
      location_id CHAR(36) NULL,
      location_id_int INT NULL,
      order_id CHAR(36) NOT NULL,
      cashier_id CHAR(36) NULL,
      receipt_id CHAR(36) NULL,
      reason TEXT NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      KEY order_refunds_store_order (store_id, order_id),
      CONSTRAINT order_refunds_order_fkey FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `)

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS order_refund_items (
      id CHAR(36) NOT NULL,
      refund_id CHAR(36) NOT NULL,
      order_item_id CHAR(36) NOT NULL,
      product_id CHAR(36) NULL,
      title TEXT NOT NULL,
      quantity DECIMAL(12,4) NOT NULL,
      unit_price DECIMAL(12,2) NOT NULL,
      tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      subtotal DECIMAL(12,2) NOT NULL,
      PRIMARY KEY (id),
      KEY order_refund_items_refund (refund_id),
      CONSTRAINT order_refund_items_refund_fkey FOREIGN KEY (refund_id) REFERENCES order_refunds (id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `)
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  await sequelize.query("DROP TABLE IF EXISTS order_refund_items")
  await sequelize.query("DROP TABLE IF EXISTS order_refunds")
  await sequelize.query("ALTER TABLE order_items DROP COLUMN refunded_qty")
}
