export const name = "20261025120000-tax-v2"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows.length > 0
}

async function isGenerated(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT EXTRA FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return /GENERATED/i.test(rows[0]?.EXTRA || "")
}

async function rename(sequelize, table, from, to, definition) {
  if ((await hasColumn(sequelize, table, from)) && !(await hasColumn(sequelize, table, to))) {
    await sequelize.query(`ALTER TABLE ${table} CHANGE COLUMN ${from} ${to} ${definition}`)
  }
}

const DEFAULT_PAYMENT_RATES = [
  ["cash", 16],
  ["card", 5],
  ["jazzcash", 5],
  ["easypaisa", 5],
]

/**
 * Taxes: sales tax (one store-wide rate), product taxes (a list per product) and category tax
 * (one per category), plus payment-method GST that the store owner switches on or off.
 * - stores.default_tax_rate -> sales_tax_rate; new stores.payment_tax_enabled (default on).
 * - products.tax_type / tax_value / tax_name -> products.taxes (JSON list). The generated
 *   total_price_each_unit / total_pack_price depended on those columns, so they become plain
 *   columns kept up to date by the app (current values are copied first).
 * - orders / order_items: default_tax_* -> sales_tax_*; order_items product_tax_type / value ->
 *   product_taxes (JSON snapshot of the taxes charged).
 * - Every store gets the default payment-method rates it is missing.
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize

  // Stores.
  await rename(sequelize, "stores", "default_tax_rate", "sales_tax_rate", "DECIMAL(5,2) NULL")
  if (!(await hasColumn(sequelize, "stores", "payment_tax_enabled"))) {
    await sequelize.query(
      "ALTER TABLE stores ADD COLUMN payment_tax_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER sales_tax_rate"
    )
  }

  // Products: one tax -> a list of taxes.
  if (!(await hasColumn(sequelize, "products", "taxes"))) {
    await sequelize.query("ALTER TABLE products ADD COLUMN taxes JSON NULL AFTER discount_name")
  }
  if (await hasColumn(sequelize, "products", "tax_type")) {
    await sequelize.query(`
      UPDATE products
      SET taxes = JSON_ARRAY(JSON_OBJECT(
        'name', COALESCE(tax_name, 'Tax'),
        'type', tax_type,
        'value', CAST(tax_value AS DECIMAL(12,2))
      ))
      WHERE tax_type IS NOT NULL AND tax_value IS NOT NULL AND (taxes IS NULL OR JSON_LENGTH(taxes) = 0)
    `)
  }
  await sequelize.query("UPDATE products SET taxes = JSON_ARRAY() WHERE taxes IS NULL")

  // The totals stop being generated columns: keep their values, then drop the old tax columns.
  for (const column of ["total_price_each_unit", "total_pack_price"]) {
    if (await isGenerated(sequelize, "products", column)) {
      await sequelize.query(`ALTER TABLE products ADD COLUMN ${column}_tmp DECIMAL(12,2) NULL`)
      await sequelize.query(`UPDATE products SET ${column}_tmp = ${column}`)
      await sequelize.query(`ALTER TABLE products DROP COLUMN ${column}`)
      await sequelize.query(
        `ALTER TABLE products CHANGE COLUMN ${column}_tmp ${column} DECIMAL(12,2) NULL`
      )
    }
  }
  for (const column of ["tax_type", "tax_value", "tax_name"]) {
    if (await hasColumn(sequelize, "products", column)) {
      await sequelize.query(`ALTER TABLE products DROP COLUMN ${column}`)
    }
  }

  // Orders and order lines.
  await rename(sequelize, "orders", "default_tax_rate", "sales_tax_rate", "DECIMAL(5,2) NULL")
  await rename(
    sequelize,
    "orders",
    "default_tax_amount",
    "sales_tax_amount",
    "DECIMAL(12,2) NOT NULL DEFAULT 0"
  )
  await rename(
    sequelize,
    "order_items",
    "default_tax_amount",
    "sales_tax_amount",
    "DECIMAL(12,2) NOT NULL DEFAULT 0"
  )
  if (!(await hasColumn(sequelize, "order_items", "product_taxes"))) {
    await sequelize.query(
      "ALTER TABLE order_items ADD COLUMN product_taxes JSON NULL AFTER sales_tax_amount"
    )
    if (await hasColumn(sequelize, "order_items", "product_tax_type")) {
      await sequelize.query(`
        UPDATE order_items
        SET product_taxes = JSON_ARRAY(JSON_OBJECT(
          'name', 'Tax',
          'type', product_tax_type,
          'value', product_tax_value,
          'amount', product_tax_amount
        ))
        WHERE product_tax_type IS NOT NULL
      `)
    }
  }
  for (const column of ["product_tax_type", "product_tax_value"]) {
    if (await hasColumn(sequelize, "order_items", column)) {
      await sequelize.query(`ALTER TABLE order_items DROP COLUMN ${column}`)
    }
  }

  // Default payment-method rates for every store that lacks them.
  for (const [method, percent] of DEFAULT_PAYMENT_RATES) {
    await sequelize.query(
      `INSERT INTO payment_method_tax_rates (id, store_id, store_id_int, payment_method, gst_percent, created_at, updated_at)
       SELECT UUID(), s.id, s.store_id_int, ?, ?, NOW(), NOW()
       FROM stores s
       WHERE NOT EXISTS (
         SELECT 1 FROM payment_method_tax_rates r WHERE r.store_id = s.id AND r.payment_method = ?
       )`,
      { replacements: [method, percent, method] }
    )
  }
}

export async function down() {
  // One-way: the old single product tax can't hold a list of taxes.
}
