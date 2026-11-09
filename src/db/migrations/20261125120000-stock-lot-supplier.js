export const name = "20261125120000-stock-lot-supplier"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    { replacements: [table, column] }
  )
  return rows.length > 0
}

const asList = (value) => {
  if (Array.isArray(value)) return value
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

/*
 * stock_lots.supplier_id: the supplier the lot came from (null = none: opening stock, a transfer of
 * stock without one, an adjustment). A stock in from another supplier opens a lot of its own, even
 * with the same expiry date.
 * Lots that already exist get the supplier of the stock-in movements that filled them, when there was
 * exactly one (a lot filled by several suppliers, or partly without one, stays null).
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (!(await hasColumn(sequelize, "stock_lots", "supplier_id"))) {
    await sequelize.query("ALTER TABLE stock_lots ADD COLUMN supplier_id CHAR(36) NULL DEFAULT NULL")
    await sequelize.query("CREATE INDEX stock_lots_supplier_id ON stock_lots (supplier_id)")
  }

  // Backfill: lot id -> the suppliers of the stock that came in to it ("" = a stock in without one).
  const [movements] = await sequelize.query(
    "SELECT supplier_id, qty, lots FROM stock_movements WHERE qty > 0 AND lots IS NOT NULL"
  )
  const seen = new Map()
  for (const movement of movements) {
    for (const lot of asList(movement.lots)) {
      if (!lot?.lot_id || !(Number(lot.qty) > 0)) continue
      if (!seen.has(lot.lot_id)) seen.set(lot.lot_id, new Set())
      seen.get(lot.lot_id).add(movement.supplier_id || "")
    }
  }
  for (const [lotId, suppliers] of seen) {
    if (suppliers.size !== 1) continue
    const [supplierId] = [...suppliers]
    if (!supplierId) continue
    await sequelize.query("UPDATE stock_lots SET supplier_id = ? WHERE id = ? AND supplier_id IS NULL", { replacements: [supplierId, lotId] })
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "stock_lots", "supplier_id")) {
    await sequelize.query("ALTER TABLE stock_lots DROP COLUMN supplier_id")
  }
}
