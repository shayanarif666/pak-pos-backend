export const name = "20261128120000-bulk-bundle-discounts"

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
 * Bulk and bundle discounts, as the shop uses them:
 *  - order_discounts.apply_to_all_orders is gone: the cashier picks an order discount.
 *  - bulk_discounts (+ bulk_discount_tiers): buy more of ONE product (or one variant) and every unit
 *    gets cheaper: 1 unit Rs 70, 10 units Rs 700 less Rs 100 = tier min_qty 10, fixed Rs 10 per unit.
 *  - bundle_discounts: buy several products together (components, each with its qty) and get a reward:
 *    free items (rewards), or a percentage / fixed amount off. bundle_discount_products now carries the
 *    qty and the unit of each component; the product_id of a component is the variant's own product row
 *    when it is one variant, else the product.
 *    A bundle made before this (a % off a whole carton) keeps one pack of its product as the component;
 *    one that listed several products used to apply to each of them separately, which a bundle no longer
 *    does, so it is switched off.
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize

  if (await hasColumn(sequelize, "order_discounts", "apply_to_all_orders")) {
    await sequelize.query("ALTER TABLE order_discounts DROP COLUMN apply_to_all_orders")
  }

  const [[storesId]] = await sequelize.query(
    `SELECT CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stores' AND COLUMN_NAME = 'id'`
  )
  const tableCharset = storesId?.collation
    ? `DEFAULT CHARSET=${storesId.charset} COLLATE=${storesId.collation}`
    : "DEFAULT CHARSET=utf8mb4"

  if (!(await hasTable(sequelize, "bulk_discounts"))) {
    await sequelize.query(`
      CREATE TABLE bulk_discounts (
        id CHAR(36) NOT NULL,
        store_id CHAR(36) NOT NULL,
        store_id_int INT NOT NULL,
        bulk_number INT NOT NULL,
        name TEXT NOT NULL,
        product_id CHAR(36) NOT NULL,
        sale_unit ENUM('unit','pack') NOT NULL DEFAULT 'unit',
        start_at DATETIME NULL,
        end_at DATETIME NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_by CHAR(36) NULL,
        deleted_at DATETIME NULL DEFAULT NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY bulk_discounts_store_number_unique (store_id, bulk_number),
        KEY bulk_discounts_product (product_id),
        CONSTRAINT bulk_discounts_store_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
        CONSTRAINT bulk_discounts_product_fkey FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
      ) ENGINE=InnoDB ${tableCharset}
    `)
  }

  if (!(await hasTable(sequelize, "bulk_discount_tiers"))) {
    await sequelize.query(`
      CREATE TABLE bulk_discount_tiers (
        id CHAR(36) NOT NULL,
        bulk_id CHAR(36) NOT NULL,
        min_qty DECIMAL(12,4) NOT NULL,
        discount_type ENUM('percentage','fixed') NOT NULL,
        discount_value DECIMAL(12,2) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY bulk_discount_tiers_unique (bulk_id, min_qty),
        CONSTRAINT bulk_discount_tiers_bulk_fkey FOREIGN KEY (bulk_id) REFERENCES bulk_discounts (id) ON DELETE CASCADE
      ) ENGINE=InnoDB ${tableCharset}
    `)
  }

  if (!(await hasColumn(sequelize, "bundle_discounts", "reward_type"))) {
    await sequelize.query(
      "ALTER TABLE bundle_discounts ADD COLUMN reward_type ENUM('free_item','percentage','fixed') NOT NULL DEFAULT 'percentage' AFTER name"
    )
    await sequelize.query("ALTER TABLE bundle_discounts MODIFY discount_type ENUM('percentage','fixed') NULL")
    await sequelize.query("ALTER TABLE bundle_discounts MODIFY discount_value DECIMAL(12,2) NULL")
  }

  if (!(await hasColumn(sequelize, "bundle_discount_products", "qty"))) {
    await sequelize.query(
      "ALTER TABLE bundle_discount_products ADD COLUMN qty DECIMAL(12,4) NOT NULL DEFAULT 1, ADD COLUMN sale_unit ENUM('unit','pack') NOT NULL DEFAULT 'pack'"
    )
    // A bundle that listed several products used to cut each of them: it now needs all of them, so it is switched off.
    await sequelize.query(`
      UPDATE bundle_discounts SET is_active = 0
      WHERE id IN (SELECT bundle_id FROM (SELECT bundle_id FROM bundle_discount_products GROUP BY bundle_id HAVING COUNT(*) > 1) many)
    `)
  }

  if (!(await hasTable(sequelize, "bundle_discount_rewards"))) {
    await sequelize.query(`
      CREATE TABLE bundle_discount_rewards (
        id CHAR(36) NOT NULL,
        bundle_id CHAR(36) NOT NULL,
        product_id CHAR(36) NOT NULL,
        qty DECIMAL(12,4) NOT NULL DEFAULT 1,
        sale_unit ENUM('unit','pack') NOT NULL DEFAULT 'unit',
        PRIMARY KEY (id),
        UNIQUE KEY bundle_discount_rewards_unique (bundle_id, product_id),
        KEY bundle_discount_rewards_product (product_id),
        CONSTRAINT bundle_discount_rewards_bundle_fkey FOREIGN KEY (bundle_id) REFERENCES bundle_discounts (id) ON DELETE CASCADE,
        CONSTRAINT bundle_discount_rewards_product_fkey FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
      ) ENGINE=InnoDB ${tableCharset}
    `)
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  await sequelize.query("DROP TABLE IF EXISTS bundle_discount_rewards")
  if (await hasColumn(sequelize, "bundle_discount_products", "qty")) {
    await sequelize.query("ALTER TABLE bundle_discount_products DROP COLUMN qty, DROP COLUMN sale_unit")
  }
  await sequelize.query("DELETE FROM bundle_discounts WHERE reward_type = 'free_item'")
  if (await hasColumn(sequelize, "bundle_discounts", "reward_type")) {
    await sequelize.query("ALTER TABLE bundle_discounts DROP COLUMN reward_type")
  }
  await sequelize.query("DROP TABLE IF EXISTS bulk_discount_tiers")
  await sequelize.query("DROP TABLE IF EXISTS bulk_discounts")
  if (!(await hasColumn(sequelize, "order_discounts", "apply_to_all_orders"))) {
    await sequelize.query("ALTER TABLE order_discounts ADD COLUMN apply_to_all_orders TINYINT(1) NOT NULL DEFAULT 1 AFTER discount_value")
  }
}
