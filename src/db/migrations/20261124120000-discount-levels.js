export const name = "20261124120000-discount-levels"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    { replacements: [table, column] }
  )
  return rows.length > 0
}

async function hasTable(sequelize, table) {
  const [rows] = await sequelize.query(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    { replacements: [table] }
  )
  return rows.length > 0
}

/*
 * The five discount levels: category, product, order, bulk (BOGO) and bundle.
 *  - Every offer that existed is discarded (soft delete + inactive): the Discounts page now holds
 *    order-level discounts only, and bulk (buy X get Y) discounts are new offers of type bogo.
 *  - order_discounts: a discount on the whole order (name, type, amount, apply to all orders).
 *  - bundle_discounts (+ bundle_discount_products): a discount on selling a whole pack / carton.
 *  - products.discount_applies_to: the product discount on the pack, the loose item, the weight, or all.
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize

  await sequelize.query("UPDATE offers SET is_active = 0, deleted_at = NOW() WHERE deleted_at IS NULL")

  if (!(await hasColumn(sequelize, "products", "discount_applies_to"))) {
    await sequelize.query(
      "ALTER TABLE products ADD COLUMN discount_applies_to ENUM('all','pack','loose','weight') NOT NULL DEFAULT 'all'"
    )
  }

  // Ids must share charset / collation with stores.id / products.id for the foreign keys.
  const [[storesId]] = await sequelize.query(
    `SELECT CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stores' AND COLUMN_NAME = 'id'`
  )
  const tableCharset = storesId?.collation
    ? `DEFAULT CHARSET=${storesId.charset} COLLATE=${storesId.collation}`
    : "DEFAULT CHARSET=utf8mb4"

  if (!(await hasTable(sequelize, "order_discounts"))) {
    await sequelize.query(`
      CREATE TABLE order_discounts (
        id CHAR(36) NOT NULL,
        store_id CHAR(36) NOT NULL,
        store_id_int INT NOT NULL,
        discount_number INT NOT NULL,
        name TEXT NOT NULL,
        discount_type ENUM('percentage','fixed') NOT NULL,
        discount_value DECIMAL(12,2) NOT NULL,
        apply_to_all_orders TINYINT(1) NOT NULL DEFAULT 1,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_by CHAR(36) NULL,
        deleted_at DATETIME NULL DEFAULT NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY order_discounts_store_number_unique (store_id, discount_number),
        CONSTRAINT order_discounts_store_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
      ) ENGINE=InnoDB ${tableCharset}
    `)
  }

  if (!(await hasTable(sequelize, "bundle_discounts"))) {
    await sequelize.query(`
      CREATE TABLE bundle_discounts (
        id CHAR(36) NOT NULL,
        store_id CHAR(36) NOT NULL,
        store_id_int INT NOT NULL,
        bundle_number INT NOT NULL,
        name TEXT NOT NULL,
        discount_type ENUM('percentage','fixed') NOT NULL,
        discount_value DECIMAL(12,2) NOT NULL,
        start_at DATETIME NULL,
        end_at DATETIME NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_by CHAR(36) NULL,
        deleted_at DATETIME NULL DEFAULT NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY bundle_discounts_store_number_unique (store_id, bundle_number),
        CONSTRAINT bundle_discounts_store_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
      ) ENGINE=InnoDB ${tableCharset}
    `)
  }

  if (!(await hasTable(sequelize, "bundle_discount_products"))) {
    await sequelize.query(`
      CREATE TABLE bundle_discount_products (
        id CHAR(36) NOT NULL,
        bundle_id CHAR(36) NOT NULL,
        product_id CHAR(36) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY bundle_discount_products_unique (bundle_id, product_id),
        KEY bundle_discount_products_product (product_id),
        CONSTRAINT bundle_discount_products_bundle_fkey FOREIGN KEY (bundle_id) REFERENCES bundle_discounts (id) ON DELETE CASCADE,
        CONSTRAINT bundle_discount_products_product_fkey FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
      ) ENGINE=InnoDB ${tableCharset}
    `)
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  await sequelize.query("DROP TABLE IF EXISTS bundle_discount_products")
  await sequelize.query("DROP TABLE IF EXISTS bundle_discounts")
  await sequelize.query("DROP TABLE IF EXISTS order_discounts")
  if (await hasColumn(sequelize, "products", "discount_applies_to")) {
    await sequelize.query("ALTER TABLE products DROP COLUMN discount_applies_to")
  }
}
