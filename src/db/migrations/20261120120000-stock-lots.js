export const name = "20261120120000-stock-lots"

async function hasTable(sequelize, table) {
  const [rows] = await sequelize.query(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    { replacements: [table] }
  )
  return rows.length > 0
}

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    { replacements: [table, column] }
  )
  return rows.length > 0
}

/*
 * Stock lots: the stock of a product (or variant) at a location in parts that came in together,
 * each with its own expiry date (Lot #1 = 25 bottles expiring 31 Dec, Lot #2 = 25 bottles expiring
 * 31 Jan). product_stocks.qty stays the total of its lots. Stock in makes a lot (or adds to the one
 * with the same expiry); stock out takes from the lot that expires first (FEFO).
 * - stock_lots: one row per lot; lot_number is the store's own (1, 2, 3…).
 * - stock_movements.lot_id / lots: the lot(s) a movement moved: [{ lot_id, lot_number, qty, expiry_date }].
 * - order_items.lots: the lots a sale line was taken from (a refund puts them back there).
 * - stock_transfer_items.lots: the lots a transfer line left from (and arrived as).
 * The stock already there becomes one lot per product and location (its qty and expiry date).
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (!(await hasTable(sequelize, "stock_lots"))) {
    await sequelize.query(`
      CREATE TABLE stock_lots (
        id CHAR(36) NOT NULL,
        store_id CHAR(36) NOT NULL,
        store_id_int INT NOT NULL,
        lot_number INT NOT NULL,
        location_id CHAR(36) NOT NULL,
        location_id_int INT NULL,
        product_id CHAR(36) NOT NULL,
        qty DECIMAL(12,4) NOT NULL DEFAULT 0,
        expiry_date DATE NULL,
        received_at DATETIME(6) NOT NULL,
        source VARCHAR(32) NOT NULL DEFAULT 'stock_in',
        deleted_at DATETIME(6) NULL DEFAULT NULL,
        created_at DATETIME(6) NOT NULL,
        updated_at DATETIME(6) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY stock_lots_store_lot_number (store_id, lot_number),
        KEY stock_lots_stock (location_id, product_id),
        KEY stock_lots_expiry (store_id, expiry_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)
    // Every stock row that holds stock becomes lot 1, 2, 3… of its store.
    await sequelize.query(`
      INSERT INTO stock_lots (id, store_id, store_id_int, lot_number, location_id, location_id_int, product_id, qty, expiry_date, received_at, source, created_at, updated_at)
      SELECT UUID(), ps.store_id, ps.store_id_int,
             ROW_NUMBER() OVER (PARTITION BY ps.store_id ORDER BY ps.created_at, ps.id),
             ps.location_id, ps.location_id_int, ps.product_id, ps.qty, ps.expiry_date,
             ps.created_at, 'opening', NOW(6), NOW(6)
      FROM product_stocks ps
      WHERE ps.qty > 0 AND ps.deleted_at IS NULL
    `)
    // Lot numbering carries on after them.
    await sequelize.query(`
      INSERT INTO counters (name, seq)
      SELECT CONCAT('stock_lot:', store_id), MAX(lot_number) FROM stock_lots GROUP BY store_id
      ON DUPLICATE KEY UPDATE seq = GREATEST(seq, VALUES(seq))
    `)
  }
  const columns = [
    ["stock_movements", "lot_id", "CHAR(36) NULL DEFAULT NULL"],
    ["stock_movements", "lots", "JSON NULL"],
    ["order_items", "lots", "JSON NULL"],
    ["stock_transfer_items", "lots", "JSON NULL"],
  ]
  for (const [table, column, type] of columns) {
    if (await hasColumn(sequelize, table, column)) continue
    await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${type}`)
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const [table, column] of [["stock_movements", "lot_id"], ["stock_movements", "lots"], ["order_items", "lots"], ["stock_transfer_items", "lots"]]) {
    if (await hasColumn(sequelize, table, column)) await sequelize.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``)
  }
  await sequelize.query("DROP TABLE IF EXISTS stock_lots")
}
