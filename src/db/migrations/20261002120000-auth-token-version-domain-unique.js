export const name = "20261002120000-auth-token-version-domain-unique"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows.length > 0
}

async function hasIndex(sequelize, table, index) {
  const [rows] = await sequelize.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    { replacements: [table, index] }
  )
  return rows.length > 0
}

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize

  // Bumped on logout / password reset so already-issued access tokens stop working.
  if (!(await hasColumn(sequelize, "users", "token_version"))) {
    await sequelize.query(
      "ALTER TABLE users ADD COLUMN token_version INT NOT NULL DEFAULT 0 AFTER refresh_token_hash"
    )
  }

  // Store custom domains as bare hostnames (no scheme, www., port or path).
  await sequelize.query(`
    UPDATE stores SET custom_domain = NULLIF(
      SUBSTRING_INDEX(SUBSTRING_INDEX(
        IF(LEFT(REPLACE(REPLACE(LOWER(TRIM(custom_domain)), 'https://', ''), 'http://', ''), 4) = 'www.',
           SUBSTRING(REPLACE(REPLACE(LOWER(TRIM(custom_domain)), 'https://', ''), 'http://', ''), 5),
           REPLACE(REPLACE(LOWER(TRIM(custom_domain)), 'https://', ''), 'http://', '')),
        '/', 1), ':', 1),
      '')
    WHERE custom_domain IS NOT NULL
  `)

  if (!(await hasIndex(sequelize, "stores", "stores_custom_domain_unique"))) {
    const [dupes] = await sequelize.query(`
      SELECT custom_domain FROM stores
      WHERE custom_domain IS NOT NULL
      GROUP BY custom_domain HAVING COUNT(*) > 1
    `)
    if (dupes.length) {
      console.warn(
        "Skipping unique index on stores.custom_domain; duplicates:",
        dupes.map((row) => row.custom_domain).join(", ")
      )
    } else {
      await sequelize.query(
        "CREATE UNIQUE INDEX stores_custom_domain_unique ON stores (custom_domain)"
      )
    }
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasIndex(sequelize, "stores", "stores_custom_domain_unique")) {
    await sequelize.query("DROP INDEX stores_custom_domain_unique ON stores")
  }
  if (await hasColumn(sequelize, "users", "token_version")) {
    await sequelize.query("ALTER TABLE users DROP COLUMN token_version")
  }
}
