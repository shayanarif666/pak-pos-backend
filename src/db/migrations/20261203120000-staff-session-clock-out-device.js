export const name = "20261203120000-staff-session-clock-out-device"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    { replacements: [table, column] }
  )
  return rows.length > 0
}

/*
 * The till a staff member clocked out on: staff_sessions.clock_out_device_id (device_id stays the till
 * they clocked in on — a shift can end on another till).
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (!(await hasColumn(sequelize, "staff_sessions", "clock_out_device_id"))) {
    await sequelize.query("ALTER TABLE staff_sessions ADD COLUMN clock_out_device_id CHAR(36) NULL AFTER device_id")
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "staff_sessions", "clock_out_device_id")) {
    await sequelize.query("ALTER TABLE staff_sessions DROP COLUMN clock_out_device_id")
  }
}
