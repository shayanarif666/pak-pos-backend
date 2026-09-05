export const name = "20260905180000-license-pending-device"

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize

  await sequelize.query(`
    ALTER TABLE store_licenses
      MODIFY COLUMN status ENUM('pending','active','expired','revoked') NOT NULL DEFAULT 'pending'
  `)

  const [cols] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_licenses' AND COLUMN_NAME = 'device_id'`
  )
  if (!cols.length) {
    await sequelize.query(
      "ALTER TABLE store_licenses ADD COLUMN device_id CHAR(36) NULL AFTER revoked_reason"
    )
  }

  const [fks] = await sequelize.query(
    `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_licenses'
       AND CONSTRAINT_NAME = 'store_licenses_device_id_fkey'`
  )
  if (!fks.length) {
    await sequelize.query(`
      ALTER TABLE store_licenses
        ADD CONSTRAINT store_licenses_device_id_fkey
        FOREIGN KEY (device_id) REFERENCES pos_devices (id) ON DELETE SET NULL
    `)
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  await sequelize.query(
    "ALTER TABLE store_licenses DROP FOREIGN KEY store_licenses_device_id_fkey"
  )
  await sequelize.query("ALTER TABLE store_licenses DROP COLUMN device_id")
  await sequelize.query(`
    ALTER TABLE store_licenses
      MODIFY COLUMN status ENUM('active','expired','revoked') NOT NULL DEFAULT 'active'
  `)
}
