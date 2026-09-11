export const name = "20260911120000-stock-expiry-date"

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  const [cols] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'product_stocks'
       AND COLUMN_NAME = 'expiry_date'`
  )
  if (!cols.length) {
    await sequelize.query(
      "ALTER TABLE product_stocks ADD COLUMN expiry_date DATE NULL AFTER low_stock_threshold"
    )
  }
  await sequelize.query(`
    UPDATE product_stocks ps
    INNER JOIN products p ON p.id = ps.product_id
    SET ps.expiry_date = p.expiry_date
    WHERE ps.expiry_date IS NULL AND p.expiry_date IS NOT NULL
  `)
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  await sequelize.query("ALTER TABLE product_stocks DROP COLUMN expiry_date")
}
