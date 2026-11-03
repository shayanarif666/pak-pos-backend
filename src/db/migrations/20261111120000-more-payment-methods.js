export const name = "20261111120000-more-payment-methods"

// Every payment method a Pakistani till takes: cash, card, the wallets (JazzCash, EasyPaisa,
// SadaPay, NayaPay, UPaisa, any other), bank transfer, Raast, cheque, online, COD and other.
// orders / payments / the payment settings tables take them all ("mixed" stays for split orders).
const METHODS = [
  "cash", "card", "jazzcash", "easypaisa", "cod", "bank_transfer", "raast", "sadapay", "nayapay", "upaisa",
  "digital_wallet", "cheque", "online", "other",
]
const enumOf = (list) => `ENUM(${list.map((value) => `'${value}'`).join(",")})`

const COLUMNS = [
  ["orders", "payment_method", [...METHODS, "mixed"]],
  ["payments", "method", [...METHODS, "mixed"]],
  ["payment_method_tax_rates", "payment_method", [...METHODS, "mixed"]],
  ["payment_method_surcharges", "method", METHODS],
]

async function columnType(sequelize, table, column) {
  const [[row]] = await sequelize.query(
    `SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nullable FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return row || null
}

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const [table, column, values] of COLUMNS) {
    const current = await columnType(sequelize, table, column)
    if (!current) continue
    // Already has every method: nothing to do.
    if (values.every((value) => current.type.includes(`'${value}'`))) continue
    await sequelize.query(
      `ALTER TABLE ${table} MODIFY ${column} ${enumOf(values)} ${current.nullable === "NO" ? "NOT NULL" : "NULL"}`
    )
  }
}

export async function down() {
  // Rows may already use the new methods; the wider enum is kept.
}
