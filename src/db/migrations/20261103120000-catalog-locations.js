export const name = "20261103120000-catalog-locations"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows.length > 0
}

// Where a category / product is sold: every location (scope "all", the default, as before) or
// only the locations listed in category_locations / product_locations (scope "selected").
const TABLES = [
  { table: "categories", links: "category_locations", fk: "category_id", after: "sort_order" },
  { table: "products", links: "product_locations", fk: "product_id", after: "low_stock_threshold" },
]

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize

  for (const { table, links, fk, after } of TABLES) {
    if (!(await hasColumn(sequelize, table, "location_scope"))) {
      const position = (await hasColumn(sequelize, table, after)) ? ` AFTER ${after}` : ""
      await sequelize.query(
        `ALTER TABLE ${table} ADD COLUMN location_scope ENUM('all','selected') NOT NULL DEFAULT 'all'${position}`
      )
    }

    // Ids must share charset/collation with <table>.id / locations.id for the foreign keys.
    const [[parentId]] = await sequelize.query(
      `SELECT CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'id'`,
      { replacements: [table] }
    )
    const tableCharset = parentId?.collation
      ? `DEFAULT CHARSET=${parentId.charset} COLLATE=${parentId.collation}`
      : "DEFAULT CHARSET=utf8mb4"

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS ${links} (
        id CHAR(36) NOT NULL,
        store_id CHAR(36) NOT NULL,
        ${fk} CHAR(36) NOT NULL,
        location_id CHAR(36) NOT NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY ${links}_${fk}_location_unique (${fk}, location_id),
        KEY ${links}_location_id (location_id),
        CONSTRAINT ${links}_${fk}_fkey FOREIGN KEY (${fk}) REFERENCES ${table} (id) ON DELETE CASCADE,
        CONSTRAINT ${links}_location_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE,
        CONSTRAINT ${links}_store_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
      ) ENGINE=InnoDB ${tableCharset}
    `)
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const { table, links } of TABLES) {
    await sequelize.query(`DROP TABLE IF EXISTS ${links}`)
    if (await hasColumn(sequelize, table, "location_scope")) {
      await sequelize.query(`ALTER TABLE ${table} DROP COLUMN location_scope`)
    }
  }
}
