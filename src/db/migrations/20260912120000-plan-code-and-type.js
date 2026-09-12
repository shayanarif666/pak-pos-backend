export const name = "20260912120000-plan-code-and-type"

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  const [codeCols] = await sequelize.query(
    `SELECT DATA_TYPE, COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'plans'
       AND COLUMN_NAME = 'code'`
  )
  if (codeCols[0]?.DATA_TYPE === "enum") {
    await sequelize.query("ALTER TABLE plans MODIFY COLUMN code VARCHAR(64) NOT NULL")
  }

  const [typeCols] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'plans'
       AND COLUMN_NAME = 'type'`
  )
  if (!typeCols.length) {
    await sequelize.query(
      "ALTER TABLE plans ADD COLUMN type ENUM('monthly','yearly') NOT NULL DEFAULT 'monthly' AFTER code"
    )
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  await sequelize.query("ALTER TABLE plans DROP COLUMN type")
}
