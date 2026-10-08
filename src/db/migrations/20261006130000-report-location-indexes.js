export const name = "20261006130000-report-location-indexes"

const INDEXES = [
  // Overview / Reports / Sales by location filtered to one branch and a date range.
  { table: "orders", name: "orders_store_location_placed", columns: "store_id, location_id, placed_at" },
  { table: "order_refunds", name: "order_refunds_store_location_created", columns: "store_id, location_id, created_at" },
  { table: "stock_movements", name: "stock_movements_store_location_created", columns: "store_id, location_id, created_at" },
]

async function hasIndex(sequelize, table, index) {
  const [rows] = await sequelize.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    { replacements: [table, index] }
  )
  return rows.length > 0
}

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const index of INDEXES) {
    if (await hasIndex(sequelize, index.table, index.name)) continue
    await sequelize.query(`CREATE INDEX ${index.name} ON ${index.table} (${index.columns})`)
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const index of INDEXES) {
    if (!(await hasIndex(sequelize, index.table, index.name))) continue
    await sequelize.query(`DROP INDEX ${index.name} ON ${index.table}`)
  }
}
