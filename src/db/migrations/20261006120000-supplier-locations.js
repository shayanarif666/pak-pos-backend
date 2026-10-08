export const name = "20261006120000-supplier-locations"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows.length > 0
}

// Which branches a supplier delivers to: every location (scope "all") or only the locations
// listed in supplier_locations (scope "selected": one branch, or several of them).
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize

  if (!(await hasColumn(sequelize, "suppliers", "location_scope"))) {
    await sequelize.query(
      "ALTER TABLE suppliers ADD COLUMN location_scope ENUM('all','selected') NOT NULL DEFAULT 'all' AFTER payment_terms"
    )
  }

  // Ids must share charset/collation with suppliers.id / locations.id for the foreign keys.
  const [[suppliersId]] = await sequelize.query(
    `SELECT CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'suppliers' AND COLUMN_NAME = 'id'`
  )
  const tableCharset = suppliersId?.collation
    ? `DEFAULT CHARSET=${suppliersId.charset} COLLATE=${suppliersId.collation}`
    : "DEFAULT CHARSET=utf8mb4"

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS supplier_locations (
      id CHAR(36) NOT NULL,
      store_id CHAR(36) NOT NULL,
      supplier_id CHAR(36) NOT NULL,
      location_id CHAR(36) NOT NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      UNIQUE KEY supplier_locations_supplier_location_unique (supplier_id, location_id),
      KEY supplier_locations_location_id (location_id),
      CONSTRAINT supplier_locations_supplier_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE CASCADE,
      CONSTRAINT supplier_locations_location_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE,
      CONSTRAINT supplier_locations_store_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
    ) ENGINE=InnoDB ${tableCharset}
  `)
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  await sequelize.query("DROP TABLE IF EXISTS supplier_locations")
  if (await hasColumn(sequelize, "suppliers", "location_scope")) {
    await sequelize.query("ALTER TABLE suppliers DROP COLUMN location_scope")
  }
}
