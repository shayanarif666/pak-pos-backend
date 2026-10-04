export const name = "20261002130000-user-sessions"

// One row per signed-in device (dashboard tab, POS till, storefront). Logout revokes only
// that row, so signing out of the dashboard does not kick the same manager off the POS.
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  // user_id must use the same charset/collation as users.id or MySQL rejects the foreign key
  // on databases whose default collation differs from the one users was created with.
  const [[usersId]] = await sequelize.query(
    `SELECT CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'id'`
  )
  const tableCharset = usersId?.collation
    ? `DEFAULT CHARSET=${usersId.charset} COLLATE=${usersId.collation}`
    : "DEFAULT CHARSET=utf8mb4"

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id CHAR(36) NOT NULL,
      user_id CHAR(36) NOT NULL,
      refresh_token_hash TEXT NULL,
      channel VARCHAR(16) NULL,
      device_id CHAR(36) NULL,
      license_id CHAR(36) NULL,
      ip_address VARCHAR(64) NULL,
      user_agent TEXT NULL,
      expires_at DATETIME(6) NOT NULL,
      revoked_at DATETIME(6) NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      KEY user_sessions_user_id (user_id),
      CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB ${tableCharset}
  `)
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query("DROP TABLE IF EXISTS user_sessions")
}
