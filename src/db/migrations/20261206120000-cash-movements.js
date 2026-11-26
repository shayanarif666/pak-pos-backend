export const name = "20261206120000-cash-movements"

async function hasTable(sequelize, table) {
  const [rows] = await sequelize.query(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    { replacements: [table] }
  )
  return rows.length > 0
}

/*
 * cash_movements: Pay In / Pay Out — every time cash goes into or out of a till's drawer by hand
 * (not a sale or a refund): change put in, the owner taking cash, a supplier paid, an expense, a
 * salary advance. Each row is one movement of one batch (the drawer of one shift); the batch's
 * cash_in / cash_out and expected cash follow it. Deleted rows stay (deleted_at) for the audit.
 *   party_type / party_id / party_name: who the cash went to or came from (supplier / customer /
 *   staff by id, or any name); from_user / to_user: the staff members who gave and took it.
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasTable(sequelize, "cash_movements")) return

  const [[storesId]] = await sequelize.query(
    `SELECT CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stores' AND COLUMN_NAME = 'id'`
  )
  const tableCharset = storesId?.collation
    ? `DEFAULT CHARSET=${storesId.charset} COLLATE=${storesId.collation}`
    : "DEFAULT CHARSET=utf8mb4"

  await sequelize.query(`
    CREATE TABLE cash_movements (
      id CHAR(36) NOT NULL,
      store_id CHAR(36) NOT NULL,
      store_id_int INT NOT NULL,
      movement_number INT NOT NULL,
      location_id CHAR(36) NOT NULL,
      location_id_int INT NOT NULL,
      batch_id CHAR(36) NULL,
      device_id CHAR(36) NULL,
      staff_id CHAR(36) NULL,
      type ENUM('pay_in','pay_out') NOT NULL,
      reason TEXT NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      party_type ENUM('supplier','customer','staff','other') NULL,
      party_id CHAR(36) NULL,
      party_name VARCHAR(255) NULL,
      from_user CHAR(36) NULL,
      to_user CHAR(36) NULL,
      occurred_at DATETIME NOT NULL,
      attachment_url VARCHAR(1024) NULL,
      client_local_id VARCHAR(128) NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      deleted_at DATETIME NULL DEFAULT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY cash_movements_store_number_unique (store_id, movement_number),
      UNIQUE KEY cash_movements_store_local_unique (store_id, client_local_id),
      KEY cash_movements_store_occurred (store_id, occurred_at),
      KEY cash_movements_location (location_id),
      KEY cash_movements_batch (batch_id),
      CONSTRAINT cash_movements_store_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
    ) ENGINE=InnoDB ${tableCharset}
  `)
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  if (await hasTable(sequelize, "cash_movements")) await sequelize.query("DROP TABLE cash_movements")
}
