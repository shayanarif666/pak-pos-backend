export const name = "20260908220000-plan-features-array"

const FLAG_COLUMNS = [
  "offline_enabled",
  "pin_override_enabled",
  "approval_enabled",
  "advanced_reports",
  "backup_restore_enabled",
  "multi_branch_enabled",
  "has_dedicated_am",
]

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  const [featureCol] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'features'`
  )
  if (!featureCol.length) {
    await sequelize.query(
      "ALTER TABLE plans ADD COLUMN features JSON NULL AFTER max_locations"
    )
  }

  const [flagCols] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans'
       AND COLUMN_NAME IN (${FLAG_COLUMNS.map(() => "?").join(",")})`,
    { replacements: FLAG_COLUMNS }
  )
  const presentFlags = flagCols.map((row) => row.COLUMN_NAME)

  if (presentFlags.length) {
    const [rows] = await sequelize.query(
      `SELECT id, ${presentFlags.join(", ")} FROM plans`
    )
    for (const row of rows) {
      const features = presentFlags.filter((key) => Boolean(row[key]))
      await sequelize.query("UPDATE plans SET features = ? WHERE id = ?", {
        replacements: [JSON.stringify(features), row.id],
      })
    }
    for (const column of presentFlags) {
      await sequelize.query(`ALTER TABLE plans DROP COLUMN \`${column}\``)
    }
  }

  await sequelize.query(
    "UPDATE plans SET features = JSON_ARRAY() WHERE features IS NULL"
  )
  await sequelize.query(
    "ALTER TABLE plans MODIFY COLUMN features JSON NOT NULL"
  )
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const column of FLAG_COLUMNS) {
    await sequelize.query(
      `ALTER TABLE plans ADD COLUMN \`${column}\` TINYINT(1) NOT NULL DEFAULT 0`
    )
  }
  await sequelize.query("ALTER TABLE plans DROP COLUMN features")
}
