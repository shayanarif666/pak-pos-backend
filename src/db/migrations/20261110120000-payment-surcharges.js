export const name = "20261110120000-payment-surcharges"

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

// Payment method surcharges: what paying by a method adds to the bill (percentage of its share,
// or a fixed amount per payment). One per method per store. They replace the payment-method GST
// rates of payment_method_tax_rates, which stay in the database unused.
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasTable(sequelize, "payment_method_surcharges")) return
  const id = await column(sequelize, "stores", "id")
  const tableCharset = id?.collation ? `DEFAULT CHARSET=${id.charset} COLLATE=${id.collation}` : "DEFAULT CHARSET=utf8mb4"
  await sequelize.query(`
    CREATE TABLE payment_method_surcharges (
      id CHAR(36) NOT NULL,
      store_id CHAR(36) NOT NULL,
      store_id_int INT NOT NULL,
      surcharge_number INT NOT NULL,
      method ENUM('cash','card','jazzcash','easypaisa','cod','bank_transfer','raast','sadapay','nayapay','upaisa','digital_wallet','cheque','online','other') NOT NULL,
      type ENUM('percentage','fixed') NOT NULL DEFAULT 'percentage',
      charges DECIMAL(12,2) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_by CHAR(36) NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      UNIQUE KEY payment_method_surcharges_number_unique (store_id, surcharge_number),
      UNIQUE KEY payment_method_surcharges_method_unique (store_id, method),
      CONSTRAINT payment_method_surcharges_store_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
    ) ENGINE=InnoDB ${tableCharset}
  `)
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query("DROP TABLE IF EXISTS payment_method_surcharges")
}
