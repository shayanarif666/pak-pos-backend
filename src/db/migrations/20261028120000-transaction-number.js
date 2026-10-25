export const name = "20261028120000-transaction-number"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows.length > 0
}

/**
 * payments.transaction_number: the transaction's short number per store (1, 2, 3...), the id the
 * POS sees — like order_number. Existing payments are numbered in the order they were made and
 * each store's counter continues from its last number.
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "payments", "transaction_number")) return
  await sequelize.query("ALTER TABLE payments ADD COLUMN transaction_number INT NULL AFTER order_id")
  await sequelize.query(`
    UPDATE payments p
    JOIN (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY store_id ORDER BY created_at, id) AS n FROM payments
    ) numbered ON numbered.id = p.id
    SET p.transaction_number = numbered.n
  `)
  await sequelize.query(`
    INSERT INTO counters (name, seq)
    SELECT CONCAT('transaction:', store_id), MAX(transaction_number) FROM payments GROUP BY store_id
    ON DUPLICATE KEY UPDATE seq = GREATEST(counters.seq, VALUES(seq))
  `)
  await sequelize.query(
    "ALTER TABLE payments ADD UNIQUE KEY payments_store_transaction_number_unique (store_id, transaction_number)"
  )
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasColumn(sequelize, "payments", "transaction_number")) {
    await sequelize.query("ALTER TABLE payments DROP INDEX payments_store_transaction_number_unique")
    await sequelize.query("ALTER TABLE payments DROP COLUMN transaction_number")
  }
}
