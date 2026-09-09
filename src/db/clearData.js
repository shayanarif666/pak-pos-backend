const KEEP_TABLES = new Set(["sequelizemeta", "plans"])

export async function clearAllBusinessTables(sequelize) {
  await sequelize.query("SET FOREIGN_KEY_CHECKS = 0")

  const cleared = []

  try {
    const [tables] = await sequelize.query("SHOW TABLES")
    const names = tables.map((row) => Object.values(row)[0])

    for (const table of names) {
      if (KEEP_TABLES.has(String(table).toLowerCase())) continue

      if (String(table).toLowerCase() === "users") {
        await sequelize.query(
          "DELETE FROM `users` WHERE role <> 'superadmin'"
        )
        cleared.push("users (non-superadmin)")
        continue
      }

      await sequelize.query(`DELETE FROM \`${table}\``)
      cleared.push(table)
    }
  } finally {
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 1")
  }

  return cleared
}
