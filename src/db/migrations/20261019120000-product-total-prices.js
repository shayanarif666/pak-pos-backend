import { TOTAL_PACK_PRICE_SQL, TOTAL_PRICE_EACH_UNIT_SQL } from "../productTotals.sql.js"

export const name = "20261019120000-product-total-prices"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows.length > 0
}

// Replaces products.net_selling_price (discount only) with total_price_each_unit and
// total_pack_price (discount, then tax). Each step checks first, so it is safe to re-run.
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize

  if (await hasColumn(sequelize, "products", "net_selling_price")) {
    await sequelize.query("ALTER TABLE products DROP COLUMN net_selling_price")
  }
  if (!(await hasColumn(sequelize, "products", "total_price_each_unit"))) {
    await sequelize.query(
      `ALTER TABLE products ADD COLUMN total_price_each_unit DECIMAL(12,2)
         GENERATED ALWAYS AS (${TOTAL_PRICE_EACH_UNIT_SQL}) STORED`
    )
  }
  if (!(await hasColumn(sequelize, "products", "total_pack_price"))) {
    await sequelize.query(
      `ALTER TABLE products ADD COLUMN total_pack_price DECIMAL(12,2)
         GENERATED ALWAYS AS (${TOTAL_PACK_PRICE_SQL}) STORED`
    )
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const column of ["total_pack_price", "total_price_each_unit"]) {
    if (await hasColumn(sequelize, "products", column)) {
      await sequelize.query(`ALTER TABLE products DROP COLUMN ${column}`)
    }
  }
}
