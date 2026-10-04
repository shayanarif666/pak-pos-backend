export const name = "20261004120000-license-suspend-extend"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows.length > 0
}

// Super Admin license actions: suspend / activate a store's license, and extend an expired one
// by a few grace days that are taken back from the next paid month.
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize

  await sequelize.query(`
    ALTER TABLE store_licenses
    MODIFY COLUMN status ENUM('pending','active','expired','revoked','suspended')
    NOT NULL DEFAULT 'pending'
  `)

  if (!(await hasColumn(sequelize, "store_licenses", "grace_days"))) {
    await sequelize.query(
      "ALTER TABLE store_licenses ADD COLUMN grace_days INT NOT NULL DEFAULT 0 AFTER expires_at"
    )
  }
  if (!(await hasColumn(sequelize, "store_licenses", "suspended_at"))) {
    await sequelize.query(
      "ALTER TABLE store_licenses ADD COLUMN suspended_at DATETIME NULL AFTER grace_days"
    )
  }
  if (!(await hasColumn(sequelize, "store_licenses", "suspended_reason"))) {
    await sequelize.query(
      "ALTER TABLE store_licenses ADD COLUMN suspended_reason TEXT NULL AFTER suspended_at"
    )
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  await sequelize.query("UPDATE store_licenses SET status = 'active' WHERE status = 'suspended'")
  for (const column of ["suspended_reason", "suspended_at", "grace_days"]) {
    if (await hasColumn(sequelize, "store_licenses", column)) {
      await sequelize.query(`ALTER TABLE store_licenses DROP COLUMN ${column}`)
    }
  }
  await sequelize.query(`
    ALTER TABLE store_licenses
    MODIFY COLUMN status ENUM('pending','active','expired','revoked') NOT NULL DEFAULT 'pending'
  `)
}
