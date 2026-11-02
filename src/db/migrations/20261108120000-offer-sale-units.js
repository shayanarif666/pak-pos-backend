export const name = "20261108120000-offer-sale-units"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows.length > 0
}

// Pack products in offers and sales:
// - offers.sale_unit: what an offer applies to on a pack product — unit (single items), pack or
//   both (default); offer_targets.sale_unit overrides it for one product. promo_pack_price is a
//   flash sale's price of the whole pack.
// - offers.min_qty_unit (bulk discount) and buy_unit / get_unit (BOGO): counted in units or packs.
// - order_items.sale_unit / pack_size / pack_price: a line sold by the pack (quantity stays in units).
const COLUMNS = [
  ["offers", "sale_unit", "ENUM('unit','pack','both') NOT NULL DEFAULT 'both' AFTER apply_to"],
  ["offers", "min_qty_unit", "ENUM('unit','pack') NOT NULL DEFAULT 'unit' AFTER min_qty"],
  ["offers", "buy_unit", "ENUM('unit','pack') NOT NULL DEFAULT 'unit' AFTER buy_qty"],
  ["offers", "get_unit", "ENUM('unit','pack') NOT NULL DEFAULT 'unit' AFTER get_qty"],
  ["offer_targets", "sale_unit", "ENUM('unit','pack','both') NULL AFTER promo_price"],
  ["offer_targets", "promo_pack_price", "DECIMAL(12,2) NULL AFTER sale_unit"],
  ["order_items", "sale_unit", "ENUM('unit','pack') NOT NULL DEFAULT 'unit' AFTER qty_packs"],
  ["order_items", "pack_size", "INT NULL AFTER sale_unit"],
  ["order_items", "pack_price", "DECIMAL(12,2) NULL AFTER pack_size"],
]

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const [table, column, definition] of COLUMNS) {
    if (!(await hasColumn(sequelize, table, column))) {
      await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const [table, column] of [...COLUMNS].reverse()) {
    if (await hasColumn(sequelize, table, column)) {
      await sequelize.query(`ALTER TABLE ${table} DROP COLUMN ${column}`)
    }
  }
}
