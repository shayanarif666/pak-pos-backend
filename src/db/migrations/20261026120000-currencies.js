export const name = "20261026120000-currencies"

/**
 * currencies: one row per store (code, name, symbol, decimals, symbol position), PKR by default.
 * New stores get their row at registration; stores registered before this get theirs from
 * PUT /currency (until then GET /currency shows the PKR defaults).
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS currencies (
      id CHAR(36) NOT NULL,
      store_id CHAR(36) NOT NULL,
      store_id_int INT NOT NULL,
      code VARCHAR(3) NOT NULL DEFAULT 'PKR',
      name VARCHAR(64) NOT NULL DEFAULT 'Pakistani Rupee',
      symbol VARCHAR(8) NOT NULL DEFAULT 'Rs',
      decimal_places TINYINT NOT NULL DEFAULT 2,
      symbol_position ENUM('before','after') NOT NULL DEFAULT 'before',
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY currencies_store_id_unique (store_id)
    ) ENGINE=InnoDB
  `)
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query("DROP TABLE IF EXISTS currencies")
}
