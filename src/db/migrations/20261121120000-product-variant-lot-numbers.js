export const name = "20261121120000-product-variant-lot-numbers"

async function indexExists(sequelize, table, index) {
  const [rows] = await sequelize.query(
    "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
    { replacements: [table, index] }
  )
  return rows.length > 0
}

const parseLots = (raw) => {
  if (Array.isArray(raw)) return raw
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

/*
 * Numbers as the POS shows them:
 * - Products: 1, 2, 3… per store, counting products only. A variant has no product number of its
 *   own any more (it is product 1, variant 1, 2, 3… — variant_number), so variants no longer use
 *   up product numbers. The products already there are numbered again, in their old order.
 * - Lots: 1, 2, 3… per product (or variant), not per store. The lots already there are numbered
 *   again per product (oldest first), and the lot numbers saved in movements, sale lines and
 *   transfer lines follow (they keep lot_id, the lot's UUID).
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize

  // ---- products ----
  await sequelize.query("ALTER TABLE products MODIFY product_number INT NULL")
  await sequelize.query("UPDATE products SET product_number = NULL WHERE parent_product_id IS NOT NULL")
  // Out of the way first, so the new numbers never meet an old one (store_id + product_number is unique).
  await sequelize.query("UPDATE products SET product_number = product_number + 100000000 WHERE product_number IS NOT NULL")
  // The new numbers go to a work table first (a pooled connection would not see a TEMPORARY one) (MySQL does not update a table from a query on
  // that same table).
  await sequelize.query("DROP TABLE IF EXISTS tmp_product_numbers")
  await sequelize.query(`
    CREATE TABLE tmp_product_numbers AS
    SELECT id, ROW_NUMBER() OVER (PARTITION BY store_id ORDER BY product_number, created_at, id) AS n
    FROM products WHERE parent_product_id IS NULL
  `)
  await sequelize.query("UPDATE products p JOIN tmp_product_numbers t ON t.id = p.id SET p.product_number = t.n")
  await sequelize.query("DROP TABLE tmp_product_numbers")
  await sequelize.query("DELETE FROM counters WHERE name LIKE 'product:%'")
  await sequelize.query(`
    INSERT INTO counters (name, seq)
    SELECT CONCAT('product:', store_id), MAX(product_number) FROM products WHERE product_number IS NOT NULL GROUP BY store_id
  `)

  // ---- lots ----
  if (await indexExists(sequelize, "stock_lots", "stock_lots_store_lot_number")) {
    await sequelize.query("ALTER TABLE stock_lots DROP INDEX stock_lots_store_lot_number")
  }
  await sequelize.query("DROP TABLE IF EXISTS tmp_lot_numbers")
  await sequelize.query(`
    CREATE TABLE tmp_lot_numbers AS
    SELECT id, ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY received_at, lot_number, id) AS n
    FROM stock_lots
  `)
  await sequelize.query("UPDATE stock_lots l JOIN tmp_lot_numbers t ON t.id = l.id SET l.lot_number = t.n")
  await sequelize.query("DROP TABLE tmp_lot_numbers")
  if (!(await indexExists(sequelize, "stock_lots", "stock_lots_product_lot_number"))) {
    await sequelize.query("ALTER TABLE stock_lots ADD UNIQUE KEY stock_lots_product_lot_number (store_id, product_id, lot_number)")
  }
  await sequelize.query("DELETE FROM counters WHERE name LIKE 'stock_lot:%'")
  await sequelize.query(`
    INSERT INTO counters (name, seq)
    SELECT CONCAT('stock_lot:', product_id), MAX(lot_number) FROM stock_lots GROUP BY product_id
  `)

  // The lot numbers saved with movements / sale lines / transfer lines, by lot_id.
  const [lots] = await sequelize.query("SELECT id, lot_number FROM stock_lots")
  const numberOf = new Map(lots.map((row) => [row.id, Number(row.lot_number)]))
  for (const table of ["stock_movements", "order_items", "stock_transfer_items"]) {
    const [rows] = await sequelize.query(`SELECT id, lots FROM \`${table}\` WHERE lots IS NOT NULL`)
    for (const row of rows) {
      const list = parseLots(row.lots)
      if (!list.length) continue
      let changed = false
      const next = list.map((lot) => {
        const number = lot?.lot_id ? numberOf.get(lot.lot_id) : undefined
        if (number == null || number === Number(lot.lot_number)) return lot
        changed = true
        return { ...lot, lot_number: number }
      })
      if (changed) {
        await sequelize.query(`UPDATE \`${table}\` SET lots = ? WHERE id = ?`, { replacements: [JSON.stringify(next), row.id] })
      }
    }
  }
}

export async function down() {
  // The old numbers are not kept; nothing to undo.
}
