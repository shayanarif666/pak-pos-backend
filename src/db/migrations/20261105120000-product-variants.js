export const name = "20261105120000-product-variants"

async function column(sequelize, table, name) {
  const [[row]] = await sequelize.query(
    `SELECT COLUMN_TYPE AS type, CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, name] }
  )
  return row || null
}

// Product variants (e.g. a polo shirt in M and L): each variant is a product of its own (own SKU,
// barcode, prices and stock) linked to its parent; the parent groups them and is not sold itself.
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (!(await column(sequelize, "products", "parent_product_id"))) {
    const id = await column(sequelize, "products", "id")
    const collate = id?.collation ? ` CHARACTER SET ${id.charset} COLLATE ${id.collation}` : ""
    await sequelize.query(`ALTER TABLE products ADD COLUMN parent_product_id CHAR(36)${collate} NULL AFTER category_id`)
    await sequelize.query("ALTER TABLE products ADD KEY products_parent_product_id (parent_product_id)")
    await sequelize.query(
      "ALTER TABLE products ADD CONSTRAINT products_parent_product_fkey FOREIGN KEY (parent_product_id) REFERENCES products (id) ON DELETE SET NULL"
    )
  }
  if (!(await column(sequelize, "products", "variant_name"))) {
    await sequelize.query("ALTER TABLE products ADD COLUMN variant_name VARCHAR(255) NULL AFTER parent_product_id")
  }
  if (!(await column(sequelize, "products", "has_variants"))) {
    await sequelize.query("ALTER TABLE products ADD COLUMN has_variants TINYINT(1) NOT NULL DEFAULT 0 AFTER variant_name")
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  await sequelize.query("ALTER TABLE products DROP FOREIGN KEY products_parent_product_fkey").catch(() => {})
  for (const name of ["has_variants", "variant_name", "parent_product_id"]) {
    if (await column(sequelize, "products", name)) await sequelize.query(`ALTER TABLE products DROP COLUMN ${name}`)
  }
}
