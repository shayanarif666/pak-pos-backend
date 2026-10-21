export const name = "20261022120000-offer-locations"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows.length > 0
}

// Where an offer runs: every location (scope "all") or only the locations listed in
// offer_locations (scope "selected": one location or several). Replaces the single
// offers.location_id, whose value is copied over; that column is left in place, unused.
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize

  if (!(await hasColumn(sequelize, "offers", "location_scope"))) {
    await sequelize.query(
      "ALTER TABLE offers ADD COLUMN location_scope ENUM('all','selected') NOT NULL DEFAULT 'all' AFTER apply_to"
    )
  }

  // Ids must share charset/collation with offers.id / locations.id for the foreign keys.
  const [[offersId]] = await sequelize.query(
    `SELECT CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'offers' AND COLUMN_NAME = 'id'`
  )
  const tableCharset = offersId?.collation
    ? `DEFAULT CHARSET=${offersId.charset} COLLATE=${offersId.collation}`
    : "DEFAULT CHARSET=utf8mb4"

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS offer_locations (
      id CHAR(36) NOT NULL,
      store_id CHAR(36) NOT NULL,
      offer_id CHAR(36) NOT NULL,
      location_id CHAR(36) NOT NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      UNIQUE KEY offer_locations_offer_location_unique (offer_id, location_id),
      KEY offer_locations_location_id (location_id),
      CONSTRAINT offer_locations_offer_fkey FOREIGN KEY (offer_id) REFERENCES offers (id) ON DELETE CASCADE,
      CONSTRAINT offer_locations_location_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE,
      CONSTRAINT offer_locations_store_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
    ) ENGINE=InnoDB ${tableCharset}
  `)

  // An offer that was tied to one location keeps running only there.
  if (await hasColumn(sequelize, "offers", "location_id")) {
    await sequelize.query(`
      INSERT IGNORE INTO offer_locations (id, store_id, offer_id, location_id)
      SELECT UUID(), store_id, id, location_id FROM offers WHERE location_id IS NOT NULL
    `)
    await sequelize.query(
      "UPDATE offers SET location_scope = 'selected' WHERE location_id IS NOT NULL"
    )
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  await sequelize.query("DROP TABLE IF EXISTS offer_locations")
  if (await hasColumn(sequelize, "offers", "location_scope")) {
    await sequelize.query("ALTER TABLE offers DROP COLUMN location_scope")
  }
}
