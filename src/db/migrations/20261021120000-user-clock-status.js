export const name = "20261021120000-user-clock-status"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows.length > 0
}

// Whether a staff member is currently on duty: login / register clock-in set "clock_in",
// logout / register clock-out set "clock_out".
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (!(await hasColumn(sequelize, "users", "status"))) {
    await sequelize.query(
      "ALTER TABLE users ADD COLUMN status ENUM('clock_in','clock_out') NOT NULL DEFAULT 'clock_out' AFTER is_active"
    )
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "users", "status")) {
    await sequelize.query("ALTER TABLE users DROP COLUMN status")
  }
}
