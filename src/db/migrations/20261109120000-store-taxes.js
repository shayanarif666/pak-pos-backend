export const name = "20261109120000-store-taxes"

async function hasTable(sequelize, table) {
  const [rows] = await sequelize.query(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    { replacements: [table] }
  )
  return rows.length > 0
}

async function column(sequelize, table, name) {
  const [[row]] = await sequelize.query(
    `SELECT CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, name] }
  )
  return row || null
}

// Store taxes: a tax defined once (name, percentage | fixed, value) for every product
// (product_scope all) or for the products listed in store_tax_products (selected).
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  const id = await column(sequelize, "products", "id")
  const tableCharset = id?.collation ? `DEFAULT CHARSET=${id.charset} COLLATE=${id.collation}` : "DEFAULT CHARSET=utf8mb4"

  if (!(await hasTable(sequelize, "store_taxes"))) {
    await sequelize.query(`
      CREATE TABLE store_taxes (
        id CHAR(36) NOT NULL,
        store_id CHAR(36) NOT NULL,
        store_id_int INT NOT NULL,
        tax_number INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        type ENUM('percentage','fixed') NOT NULL,
        value DECIMAL(12,2) NOT NULL,
        product_scope ENUM('all','selected') NOT NULL DEFAULT 'all',
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_by CHAR(36) NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY store_taxes_store_number_unique (store_id, tax_number),
        CONSTRAINT store_taxes_store_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
      ) ENGINE=InnoDB ${tableCharset}
    `)
  }
  if (!(await hasTable(sequelize, "store_tax_products"))) {
    await sequelize.query(`
      CREATE TABLE store_tax_products (
        id CHAR(36) NOT NULL,
        tax_id CHAR(36) NOT NULL,
        product_id CHAR(36) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY store_tax_products_unique (tax_id, product_id),
        KEY store_tax_products_product_id (product_id),
        CONSTRAINT store_tax_products_tax_fkey FOREIGN KEY (tax_id) REFERENCES store_taxes (id) ON DELETE CASCADE,
        CONSTRAINT store_tax_products_product_fkey FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
      ) ENGINE=InnoDB ${tableCharset}
    `)
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  await sequelize.query("DROP TABLE IF EXISTS store_tax_products")
  await sequelize.query("DROP TABLE IF EXISTS store_taxes")
}
