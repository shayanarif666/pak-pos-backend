export const name = "20260913120000-order-tax-breakdown"

const ORDER_COLUMNS = [
  ["default_tax_rate", "DECIMAL(5,2) NULL AFTER tax_amount"],
  ["default_tax_amount", "DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER default_tax_rate"],
  ["product_tax_amount", "DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER default_tax_amount"],
  ["category_tax_amount", "DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER product_tax_amount"],
  ["payment_gst_amount", "DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER category_tax_amount"],
  ["fbr_invoice_enabled", "TINYINT(1) NOT NULL DEFAULT 0 AFTER payment_gst_amount"],
  ["fbr_tax_amount", "DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER fbr_invoice_enabled"],
  ["tax_breakdown", "JSON NULL AFTER fbr_tax_amount"],
]

const ITEM_COLUMNS = [
  ["product_tax_amount", "DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER tax_amount"],
  ["category_tax_amount", "DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER product_tax_amount"],
  ["default_tax_amount", "DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER category_tax_amount"],
  ["product_tax_type", "VARCHAR(32) NULL AFTER default_tax_amount"],
  ["product_tax_value", "DECIMAL(5,2) NULL AFTER product_tax_type"],
  ["category_tax_type", "VARCHAR(32) NULL AFTER product_tax_value"],
  ["category_tax_value", "DECIMAL(5,2) NULL AFTER category_tax_type"],
]

async function addMissing(sequelize, table, columns) {
  for (const [name, definition] of columns) {
    const [rows] = await sequelize.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
         AND COLUMN_NAME = ?`,
      { replacements: [table, name] }
    )
    if (!rows.length) {
      await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
    }
  }
}

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  await addMissing(sequelize, "orders", ORDER_COLUMNS)
  await addMissing(sequelize, "order_items", ITEM_COLUMNS)
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const [name] of [...ORDER_COLUMNS].reverse()) {
    await sequelize.query(`ALTER TABLE orders DROP COLUMN ${name}`)
  }
  for (const [name] of [...ITEM_COLUMNS].reverse()) {
    await sequelize.query(`ALTER TABLE order_items DROP COLUMN ${name}`)
  }
}
