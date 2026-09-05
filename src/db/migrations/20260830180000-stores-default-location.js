export const name = "20260830180000-stores-default-location"

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize

  const [cols] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stores' AND COLUMN_NAME = 'location_id'`
  )
  if (!cols.length) {
    await sequelize.query(
      "ALTER TABLE stores ADD COLUMN location_id CHAR(36) NULL AFTER owner_id"
    )
    await sequelize.query(
      "ALTER TABLE stores ADD COLUMN location_id_int INT NULL AFTER location_id"
    )
  }

  const [fks] = await sequelize.query(
    `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stores'
       AND CONSTRAINT_NAME = 'stores_location_id_fkey'`
  )
  if (!fks.length) {
    await sequelize.query(`
      ALTER TABLE stores
        ADD CONSTRAINT stores_location_id_fkey
        FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL
    `)
  }
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query(
    "ALTER TABLE stores DROP FOREIGN KEY stores_location_id_fkey"
  )
  await queryInterface.sequelize.query(
    "ALTER TABLE stores DROP COLUMN location_id_int, DROP COLUMN location_id"
  )
}
