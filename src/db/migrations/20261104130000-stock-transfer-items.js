export const name = "20261104130000-stock-transfer-items"

async function hasTable(sequelize, table) {
  const [rows] = await sequelize.query(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    { replacements: [table] }
  )
  return rows.length > 0
}

async function column(sequelize, table, name) {
  const [[row]] = await sequelize.query(
    `SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nullable, CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, name] }
  )
  return row || null
}

// A transfer now sends several products from one location to several locations: stock_transfers is
// the shipment (from, status, note) and stock_transfer_items holds one row per product per
// destination (qty, received_qty, its own status). Every existing transfer becomes one item; its
// old to_location_id / product_id / qty columns stay (nullable) for the rows already there.
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize

  for (const name of ["to_location_id", "product_id"]) {
    const col = await column(sequelize, "stock_transfers", name)
    if (col && col.nullable === "NO") {
      const collate = col.collation ? ` CHARACTER SET ${col.charset} COLLATE ${col.collation}` : ""
      await sequelize.query(`ALTER TABLE stock_transfers MODIFY ${name} ${col.type}${collate} NULL`)
    }
  }
  const qty = await column(sequelize, "stock_transfers", "qty")
  if (qty && qty.nullable === "NO") {
    await sequelize.query(`ALTER TABLE stock_transfers MODIFY qty ${qty.type} NULL`)
  }

  if (!(await hasTable(sequelize, "stock_transfer_items"))) {
    const id = await column(sequelize, "stock_transfers", "id")
    const tableCharset = id?.collation
      ? `DEFAULT CHARSET=${id.charset} COLLATE=${id.collation}`
      : "DEFAULT CHARSET=utf8mb4"
    await sequelize.query(`
      CREATE TABLE stock_transfer_items (
        id CHAR(36) NOT NULL,
        store_id CHAR(36) NOT NULL,
        transfer_id CHAR(36) NOT NULL,
        item_number INT NOT NULL,
        to_location_id CHAR(36) NOT NULL,
        product_id CHAR(36) NOT NULL,
        qty DECIMAL(12,4) NOT NULL,
        received_qty DECIMAL(12,4) NULL,
        status ENUM('pending','on_the_way','completed','cancelled') NOT NULL DEFAULT 'on_the_way',
        received_at DATETIME(6) NULL,
        received_by CHAR(36) NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY stock_transfer_items_transfer_item_unique (transfer_id, item_number),
        KEY stock_transfer_items_to_location_id (to_location_id),
        KEY stock_transfer_items_product_id (product_id),
        CONSTRAINT stock_transfer_items_transfer_fkey FOREIGN KEY (transfer_id) REFERENCES stock_transfers (id) ON DELETE CASCADE,
        CONSTRAINT stock_transfer_items_location_fkey FOREIGN KEY (to_location_id) REFERENCES locations (id),
        CONSTRAINT stock_transfer_items_product_fkey FOREIGN KEY (product_id) REFERENCES products (id),
        CONSTRAINT stock_transfer_items_store_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
      ) ENGINE=InnoDB ${tableCharset}
    `)
  }

  // One item per existing transfer (skipped for a transfer that already has items).
  await sequelize.query(`
    INSERT INTO stock_transfer_items
      (id, store_id, transfer_id, item_number, to_location_id, product_id, qty, received_qty, status, received_at, created_at, updated_at)
    SELECT UUID(), t.store_id, t.id, 1, t.to_location_id, t.product_id, t.qty, t.received_qty, t.status,
           CASE WHEN t.status = 'completed' THEN t.updated_at ELSE NULL END, t.created_at, t.updated_at
    FROM stock_transfers t
    WHERE t.to_location_id IS NOT NULL AND t.product_id IS NOT NULL AND t.qty IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM stock_transfer_items i WHERE i.transfer_id = t.id)
  `)
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query("DROP TABLE IF EXISTS stock_transfer_items")
}
