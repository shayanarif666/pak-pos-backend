export const name = "20260908120000-order-pricing-breakdown"

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  await sequelize.query(`
    ALTER TABLE orders
      ADD COLUMN gross_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER client_local_id,
      ADD COLUMN line_discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER gross_amount
  `)
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  await sequelize.query(`
    ALTER TABLE orders
      DROP COLUMN line_discount_amount,
      DROP COLUMN gross_amount
  `)
}
