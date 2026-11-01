export const name = "20261107120000-variant-number-stock-scope"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows.length > 0
}

async function hasIndex(sequelize, table, index) {
  const [rows] = await sequelize.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    { replacements: [table, index] }
  )
  return rows.length > 0
}

// products.variant_number: a variant's number inside its product (1, 2, 3… for every product).
// products.stock_scope / stock_location_ids: the locations that hold the product's stock, out of
// the ones it is sold at (all = every location it is sold at).
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (!(await hasColumn(sequelize, "products", "variant_number"))) {
    await sequelize.query("ALTER TABLE products ADD COLUMN variant_number INT NULL AFTER variant_name")
    // Variants made before this: numbered 1, 2, 3… per product, oldest first.
    const [rows] = await sequelize.query(
      "SELECT id, parent_product_id FROM products WHERE parent_product_id IS NOT NULL ORDER BY parent_product_id, product_number"
    )
    const next = new Map()
    for (const row of rows) {
      const number = (next.get(row.parent_product_id) || 0) + 1
      next.set(row.parent_product_id, number)
      await sequelize.query("UPDATE products SET variant_number = ? WHERE id = ?", { replacements: [number, row.id] })
    }
  }
  if (!(await hasIndex(sequelize, "products", "products_parent_variant_number"))) {
    await sequelize.query(
      "ALTER TABLE products ADD UNIQUE KEY products_parent_variant_number (parent_product_id, variant_number)"
    )
  }
  if (!(await hasColumn(sequelize, "products", "stock_scope"))) {
    await sequelize.query(
      "ALTER TABLE products ADD COLUMN stock_scope ENUM('all','selected') NOT NULL DEFAULT 'all' AFTER location_scope"
    )
  }
  if (!(await hasColumn(sequelize, "products", "stock_location_ids"))) {
    await sequelize.query("ALTER TABLE products ADD COLUMN stock_location_ids JSON NULL AFTER stock_scope")
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasIndex(sequelize, "products", "products_parent_variant_number")) {
    await sequelize.query("ALTER TABLE products DROP INDEX products_parent_variant_number")
  }
  for (const column of ["stock_location_ids", "stock_scope", "variant_number"]) {
    if (await hasColumn(sequelize, "products", column)) {
      await sequelize.query(`ALTER TABLE products DROP COLUMN ${column}`)
    }
  }
}
