export const name = "20260916120000-store-custom-domain"

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  const [cols] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stores' AND COLUMN_NAME = 'custom_domain'`
  )
  if (!cols.length) {
    await sequelize.query(
      "ALTER TABLE stores ADD COLUMN custom_domain VARCHAR(255) NULL AFTER slug"
    )
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  const [cols] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stores' AND COLUMN_NAME = 'custom_domain'`
  )
  if (cols.length) {
    await sequelize.query("ALTER TABLE stores DROP COLUMN custom_domain")
  }
}
