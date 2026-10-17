export const name = "20261018120000-catalog-pricing-fields"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows.length > 0
}

async function columnType(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows[0]?.COLUMN_TYPE || ""
}

const UNIT_ENUM =
  "ENUM('piece','kg','gram','liter','ml','packet','box','dozen','pair','meter','yard','roll','set','carton','bag','bottle','can')"

// Product pack pricing + generated net_selling_price, tax/discount display names on products and
// categories, the wider unit list, and dropping product columns the code no longer uses
// (expiry_date lives on product_stocks; image_url is replaced by featured_image/images;
// has_product_tax was briefly added and is not stored). Each step checks first, so this is safe
// on a database where some of these were already applied by hand.
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize

  if (!(await hasColumn(sequelize, "products", "pack_cost_price"))) {
    await sequelize.query(
      "ALTER TABLE products ADD COLUMN pack_cost_price DECIMAL(12,2) NULL AFTER pack_size"
    )
  }
  if (!(await hasColumn(sequelize, "products", "pack_selling_price"))) {
    await sequelize.query(
      "ALTER TABLE products ADD COLUMN pack_selling_price DECIMAL(12,2) NULL AFTER pack_cost_price"
    )
  }
  if (!(await hasColumn(sequelize, "products", "net_selling_price"))) {
    await sequelize.query(`
      ALTER TABLE products ADD COLUMN net_selling_price DECIMAL(12,2)
        GENERATED ALWAYS AS (
          CASE
            WHEN has_product_discount = 1 AND discount_type = 'percentage'
              THEN ROUND(selling_price * (1 - discount_value / 100), 2)
            WHEN has_product_discount = 1 AND discount_type = 'fixed'
              THEN GREATEST(selling_price - discount_value, 0)
            ELSE selling_price
          END
        ) STORED
    `)
  }
  if (!(await hasColumn(sequelize, "products", "discount_name"))) {
    await sequelize.query(
      "ALTER TABLE products ADD COLUMN discount_name VARCHAR(255) NULL AFTER discount_value"
    )
  }
  if (!(await hasColumn(sequelize, "products", "tax_name"))) {
    await sequelize.query(
      "ALTER TABLE products ADD COLUMN tax_name VARCHAR(255) NULL AFTER tax_value"
    )
  }
  if (await hasColumn(sequelize, "products", "expiry_date")) {
    await sequelize.query("ALTER TABLE products DROP COLUMN expiry_date")
  }
  if (await hasColumn(sequelize, "products", "has_product_tax")) {
    await sequelize.query("ALTER TABLE products DROP COLUMN has_product_tax")
  }
  if (await hasColumn(sequelize, "products", "image_url")) {
    // Carry any image that only lives in image_url over before the column goes.
    await sequelize.query(`
      UPDATE products
      SET featured_image = image_url
      WHERE (featured_image IS NULL OR featured_image = '')
        AND image_url IS NOT NULL AND image_url != ''
    `)
    await sequelize.query(`
      UPDATE products
      SET images = JSON_ARRAY(JSON_OBJECT('url', featured_image))
      WHERE (images IS NULL OR JSON_LENGTH(images) = 0)
        AND featured_image IS NOT NULL AND featured_image != ''
    `)
    await sequelize.query("ALTER TABLE products DROP COLUMN image_url")
  }

  if (!(await columnType(sequelize, "products", "unit")).includes("'can'")) {
    await sequelize.query(
      `ALTER TABLE products MODIFY COLUMN unit ${UNIT_ENUM} NOT NULL DEFAULT 'piece'`
    )
  }
  if (!(await columnType(sequelize, "order_items", "unit")).includes("'can'")) {
    await sequelize.query(`ALTER TABLE order_items MODIFY COLUMN unit ${UNIT_ENUM} NULL`)
  }

  if (!(await hasColumn(sequelize, "categories", "tax_name"))) {
    await sequelize.query(
      "ALTER TABLE categories ADD COLUMN tax_name VARCHAR(255) NULL AFTER tax_value"
    )
  }
  if (!(await hasColumn(sequelize, "categories", "discount_name"))) {
    await sequelize.query(
      "ALTER TABLE categories ADD COLUMN discount_name VARCHAR(255) NULL AFTER discount_value"
    )
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const [table, column] of [
    ["categories", "discount_name"],
    ["categories", "tax_name"],
    ["products", "tax_name"],
    ["products", "discount_name"],
    ["products", "net_selling_price"],
    ["products", "pack_selling_price"],
    ["products", "pack_cost_price"],
  ]) {
    if (await hasColumn(sequelize, table, column)) {
      await sequelize.query(`ALTER TABLE ${table} DROP COLUMN ${column}`)
    }
  }
  if (!(await hasColumn(sequelize, "products", "image_url"))) {
    await sequelize.query("ALTER TABLE products ADD COLUMN image_url TEXT NULL AFTER barcode")
    await sequelize.query("UPDATE products SET image_url = featured_image")
  }
  if (!(await hasColumn(sequelize, "products", "expiry_date"))) {
    await sequelize.query("ALTER TABLE products ADD COLUMN expiry_date DATE NULL")
  }
}
