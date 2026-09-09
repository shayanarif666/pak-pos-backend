export const name = "20260906220000-category-discount-fields"

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  const [cols] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'discount_type'`
  )
  if (cols.length) return
  await sequelize.query(`
    ALTER TABLE categories
      ADD COLUMN discount_type ENUM('percentage', 'fixed') NULL AFTER tax_value,
      ADD COLUMN discount_value DECIMAL(12,2) NULL AFTER discount_type
  `)
}
