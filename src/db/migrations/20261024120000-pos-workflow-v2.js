export const name = "20261024120000-pos-workflow-v2"

async function hasColumn(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows.length > 0
}

async function columnType(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows[0]?.COLUMN_TYPE || ""
}

async function addColumn(sequelize, table, column, definition) {
  if (!(await hasColumn(sequelize, table, column))) {
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

async function tableCharset(sequelize, table) {
  const [[row]] = await sequelize.query(
    `SELECT CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'id'`,
    { replacements: [table] }
  )
  return row?.collation
    ? `DEFAULT CHARSET=${row.charset} COLLATE=${row.collation}`
    : "DEFAULT CHARSET=utf8mb4"
}

/**
 * POS workflow v2:
 * - Trial / active on stores and licenses (store.status, store.trial_ends_at, license "trial").
 * - Plan features as columns (limits, reporting level, feature switches).
 * - Staff attendance (staff_sessions: clock in / clock out) split from the cash drawer:
 *   register_sessions become batches (status open / closed). users.status (the old on-duty flag)
 *   is dropped — attendance lives in staff_sessions now.
 * - unit_sold (units sold so far) on product_stocks and on each stock movement.
 * - order_items.custom_category for custom sale lines; stock transfers get "on_the_way".
 * Each step checks first, so this is safe to re-run.
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize

  // Stores: trial / active.
  await addColumn(
    sequelize,
    "stores",
    "status",
    "ENUM('trial','active') NOT NULL DEFAULT 'active' AFTER is_active"
  )
  await addColumn(sequelize, "stores", "trial_ends_at", "DATETIME NULL AFTER status")

  // Licenses: "trial" status and the last renewal time.
  if (!(await columnType(sequelize, "store_licenses", "status")).includes("'trial'")) {
    // MODIFY copies the table and re-checks foreign keys: drop links to devices that no longer exist.
    await sequelize.query(
      `UPDATE store_licenses l LEFT JOIN pos_devices d ON d.id = l.device_id
       SET l.device_id = NULL
       WHERE l.device_id IS NOT NULL AND d.id IS NULL`
    )
    await sequelize.query(
      "ALTER TABLE store_licenses MODIFY COLUMN status ENUM('pending','trial','active','expired','revoked','suspended') NOT NULL DEFAULT 'pending'"
    )
  }
  await addColumn(sequelize, "store_licenses", "renewed_at", "DATETIME NULL")

  // Plans: feature limits and switches.
  await addColumn(sequelize, "plans", "max_users", "INT NULL AFTER max_locations")
  await addColumn(
    sequelize,
    "plans",
    "reporting_level",
    "ENUM('basic','standard','advanced','custom') NOT NULL DEFAULT 'basic' AFTER max_users"
  )
  for (const flag of [
    "import_export",
    "staff_attendance",
    "email_integration",
    "whatsapp_integration",
    "receipt_customization",
    "barcode_scanning",
    "batch_management",
    "remote_access",
  ]) {
    await addColumn(sequelize, "plans", flag, "TINYINT(1) NOT NULL DEFAULT 0")
  }

  // Staff attendance.
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS staff_sessions (
      id CHAR(36) NOT NULL,
      store_id CHAR(36) NOT NULL,
      store_id_int INT NOT NULL,
      session_number INT NOT NULL,
      location_id CHAR(36) NULL,
      location_id_int INT NULL,
      user_id CHAR(36) NOT NULL,
      device_id CHAR(36) NULL,
      status ENUM('clock_in','clock_out') NOT NULL DEFAULT 'clock_in',
      clock_in_at DATETIME NOT NULL,
      clock_out_at DATETIME NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      UNIQUE KEY staff_sessions_store_session_number_unique (store_id, session_number),
      KEY staff_sessions_store_user_status (store_id, user_id, status),
      CONSTRAINT staff_sessions_store_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
      CONSTRAINT staff_sessions_location_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL,
      CONSTRAINT staff_sessions_user_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB ${await tableCharset(sequelize, "stores")}
  `)

  // Register sessions become batches: clock_in -> open, clock_out -> closed.
  const sessionStatus = await columnType(sequelize, "register_sessions", "status")
  if (!sessionStatus.includes("'open'")) {
    await sequelize.query(
      "ALTER TABLE register_sessions MODIFY COLUMN status ENUM('clock_in','clock_out','open','closed') NOT NULL DEFAULT 'open'"
    )
    await sequelize.query("UPDATE register_sessions SET status = 'open' WHERE status = 'clock_in'")
    await sequelize.query(
      "UPDATE register_sessions SET status = 'closed' WHERE status = 'clock_out'"
    )
    await sequelize.query(
      "ALTER TABLE register_sessions MODIFY COLUMN status ENUM('open','closed') NOT NULL DEFAULT 'open'"
    )
  }
  await addColumn(sequelize, "register_sessions", "staff_session_id", "CHAR(36) NULL AFTER device_id")

  // The old on-duty flag; attendance is in staff_sessions now.
  if (await hasColumn(sequelize, "users", "status")) {
    await sequelize.query("ALTER TABLE users DROP COLUMN status")
  }

  // Units sold so far.
  await addColumn(
    sequelize,
    "product_stocks",
    "unit_sold",
    "DECIMAL(12,4) NOT NULL DEFAULT 0 AFTER qty"
  )
  await addColumn(sequelize, "stock_movements", "unit_sold", "DECIMAL(12,4) NULL AFTER qty_after")

  // Custom sale lines keep the category typed at the till.
  await addColumn(sequelize, "order_items", "custom_category", "VARCHAR(255) NULL AFTER title")

  // Stock transfers: in transit between locations.
  if (!(await columnType(sequelize, "stock_transfers", "status")).includes("'on_the_way'")) {
    await sequelize.query(
      "ALTER TABLE stock_transfers MODIFY COLUMN status ENUM('pending','on_the_way','completed','cancelled') NOT NULL DEFAULT 'on_the_way'"
    )
  }
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  await sequelize.query("DROP TABLE IF EXISTS staff_sessions")
  for (const [table, column] of [
    ["stores", "status"],
    ["stores", "trial_ends_at"],
    ["store_licenses", "renewed_at"],
    ["register_sessions", "staff_session_id"],
    ["product_stocks", "unit_sold"],
    ["stock_movements", "unit_sold"],
    ["order_items", "custom_category"],
  ]) {
    if (await hasColumn(sequelize, table, column)) {
      await sequelize.query(`ALTER TABLE ${table} DROP COLUMN ${column}`)
    }
  }
}
