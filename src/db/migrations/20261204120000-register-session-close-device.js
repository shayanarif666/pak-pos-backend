export const name = "20261204120000-register-session-close-device"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    { replacements: [table, column] }
  )
  return rows.length > 0
}

/*
 * The till a batch was closed on: register_sessions.close_device_id (device_id stays the till it was
 * opened on — the drawer can be counted and closed from another till or the dashboard).
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (!(await hasColumn(sequelize, "register_sessions", "close_device_id"))) {
    await sequelize.query("ALTER TABLE register_sessions ADD COLUMN close_device_id CHAR(36) NULL AFTER device_id")
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "register_sessions", "close_device_id")) {
    await sequelize.query("ALTER TABLE register_sessions DROP COLUMN close_device_id")
  }
}
