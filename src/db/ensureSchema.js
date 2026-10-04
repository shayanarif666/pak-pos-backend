import { sequelize } from "./sequelize.js"
import { logger } from "../config/logger.js"
import * as productImagesFeatured from "./migrations/20260923120000-product-images-featured.js"
import * as authTokenVersionDomainUnique from "./migrations/20261002120000-auth-token-version-domain-unique.js"
import * as userSessions from "./migrations/20261002130000-user-sessions.js"

// Migrations the running code cannot work without (e.g. users.token_version is read on every
// authenticated request). Each one checks before it changes anything, so running it on a
// database that already has the change is a no-op. Deploys that only run `npm start` used to
// skip `db:migrate`, which left production failing with "Unknown column 'token_version'".
const REQUIRED = [productImagesFeatured, authTokenVersionDomainUnique, userSessions]

export async function ensureSchema() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS SequelizeMeta (
      name VARCHAR(255) NOT NULL,
      PRIMARY KEY (name)
    ) ENGINE=InnoDB
  `)

  const queryInterface = sequelize.getQueryInterface()
  for (const migration of REQUIRED) {
    const [rows] = await sequelize.query("SELECT name FROM SequelizeMeta WHERE name = ?", {
      replacements: [migration.name],
    })
    if (rows.length) continue

    await migration.up(queryInterface)
    await sequelize.query("INSERT IGNORE INTO SequelizeMeta (name) VALUES (?)", {
      replacements: [migration.name],
    })
    logger.info(`Schema updated: ${migration.name}`)
  }
}
