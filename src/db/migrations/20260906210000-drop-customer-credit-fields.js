export const name = "20260906210000-drop-customer-credit-fields"

const COLUMNS = [
  "credit_limit",
  "credit_balance",
  "total_debt",
  "remaining_debt",
  "debt_notes",
]

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  const [cols] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'
       AND COLUMN_NAME IN (${COLUMNS.map(() => "?").join(", ")})`,
    { replacements: COLUMNS }
  )
  const existing = new Set(cols.map((row) => row.COLUMN_NAME))
  for (const column of COLUMNS) {
    if (existing.has(column)) {
      await sequelize.query(`ALTER TABLE customers DROP COLUMN ${column}`)
    }
  }
}
