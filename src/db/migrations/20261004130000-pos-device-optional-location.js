export const name = "20261004130000-pos-device-optional-location"

async function isNullable(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT IS_NULLABLE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows[0]?.IS_NULLABLE === "YES"
}

// A till registered through POST /licenses/validate has no location until the store admin
// assigns one (PATCH /pos-devices/:id). The foreign key to locations stays in place.
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (!(await isNullable(sequelize, "pos_devices", "location_id"))) {
    await sequelize.query("ALTER TABLE pos_devices MODIFY COLUMN location_id CHAR(36) NULL")
  }
  if (!(await isNullable(sequelize, "pos_devices", "location_id_int"))) {
    await sequelize.query("ALTER TABLE pos_devices MODIFY COLUMN location_id_int INT NULL")
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  const [[unassigned]] = await sequelize.query(
    "SELECT COUNT(*) AS n FROM pos_devices WHERE location_id IS NULL"
  )
  if (Number(unassigned.n) > 0) {
    throw new Error("Assign a location to every POS device before reverting this migration")
  }
  await sequelize.query("ALTER TABLE pos_devices MODIFY COLUMN location_id_int INT NOT NULL")
  await sequelize.query("ALTER TABLE pos_devices MODIFY COLUMN location_id CHAR(36) NOT NULL")
}
