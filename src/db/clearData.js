export const BUSINESS_TABLES = [
  "audit_logs",
  "store_backups",
  "reviews",
  "stock_transfers",
  "stock_movements",
  "receipts",
  "payments",
  "order_items",
  "coupon_redemptions",
  "customer_credit_entries",
  "approval_requests",
  "orders",
  "register_sessions",
  "coupons",
  "offer_targets",
  "offers",
  "addresses",
  "cart_items",
  "carts",
  "customers",
  "supplier_ledger",
  "suppliers",
  "product_bulk_tiers",
  "product_stocks",
  "products",
  "categories",
  "payment_method_tax_rates",
  "shipping_rules",
  "store_banners",
  "website_content",
  "store_themes",
  "pos_devices",
  "billings",
  "store_licenses",
  "auth_tokens",
  "users",
  "locations",
  "stores",
  "counters",
  "plans",
]

export async function clearAllBusinessTables(sequelize) {
  await sequelize.query("SET FOREIGN_KEY_CHECKS = 0")

  const cleared = []

  try {
    for (const table of BUSINESS_TABLES) {
      const [rows] = await sequelize.query("SHOW TABLES LIKE ?", {
        replacements: [table],
      })
      if (!rows.length) continue

      await sequelize.query(`DELETE FROM \`${table}\``)
      cleared.push(table)
    }
  } finally {
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 1")
  }

  return cleared
}
