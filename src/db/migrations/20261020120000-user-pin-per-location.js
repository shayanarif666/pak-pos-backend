export const name = "20261020120000-user-pin-per-location"

const NEW_INDEX = "users_store_location_pin_unique"

// Unique index names on `users` whose columns are exactly the given list, in order.
async function uniqueIndexesOn(sequelize, columns) {
  const [rows] = await sequelize.query(
    `SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND NON_UNIQUE = 0
     GROUP BY INDEX_NAME`
  )
  return rows.filter((row) => row.cols === columns.join(",")).map((row) => row.INDEX_NAME)
}

// A PIN used to be unique per store (store_id, pin); now it is unique per location, so the same
// PIN can be reused at another location of the same store.
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize

  if (!(await uniqueIndexesOn(sequelize, ["store_id", "location_id", "pin"])).length) {
    await sequelize.query(`CREATE UNIQUE INDEX ${NEW_INDEX} ON users (store_id, location_id, pin)`)
  }
  for (const index of await uniqueIndexesOn(sequelize, ["store_id", "pin"])) {
    await sequelize.query(`DROP INDEX \`${index}\` ON users`)
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (!(await uniqueIndexesOn(sequelize, ["store_id", "pin"])).length) {
    await sequelize.query("CREATE UNIQUE INDEX users_store_id_pin_unique ON users (store_id, pin)")
  }
  for (const index of await uniqueIndexesOn(sequelize, ["store_id", "location_id", "pin"])) {
    await sequelize.query(`DROP INDEX \`${index}\` ON users`)
  }
}
