export const name = "20260906213000-customer-debt-fields"

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize

  async function addColumn(column, ddl) {
    const [cols] = await sequelize.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = ?`,
      { replacements: [column] }
    )
    if (!cols.length) await sequelize.query(ddl)
  }

  await addColumn(
    "total_debt",
    "ALTER TABLE customers ADD COLUMN total_debt DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER phone"
  )
  await addColumn(
    "remaining_debt",
    "ALTER TABLE customers ADD COLUMN remaining_debt DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER total_debt"
  )
  await addColumn(
    "debt_notes",
    "ALTER TABLE customers ADD COLUMN debt_notes TEXT NULL AFTER remaining_debt"
  )

  await sequelize.query(`
    UPDATE customers c
    SET
      total_debt = (
        SELECT COALESCE(SUM(e.amount), 0)
        FROM customer_credit_entries e
        WHERE e.customer_id = c.id AND e.entry_type = 'debit'
      ),
      remaining_debt = GREATEST(0, (
        SELECT COALESCE(SUM(CASE WHEN e.entry_type = 'debit' THEN e.amount ELSE -e.amount END), 0)
        FROM customer_credit_entries e
        WHERE e.customer_id = c.id
      ))
  `)
}
