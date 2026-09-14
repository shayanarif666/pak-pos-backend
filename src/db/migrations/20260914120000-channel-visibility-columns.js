export const name = "20260914120000-channel-visibility-columns"

const CATALOG_TABLES = [
  "categories",
  "products",
  "product_stocks",
  "product_bulk_tiers",
  "stock_movements",
  "customers",
  "customer_credit_entries",
  "suppliers",
  "supplier_ledger",
]

const SALE_TABLES = [
  "order_items",
  "order_refunds",
  "order_refund_items",
  "payments",
  "receipts",
]

async function columnExists(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  )
  return rows.length > 0
}

async function renameVisibility(sequelize, table) {
  if (
    (await columnExists(sequelize, table, "pos_visible")) &&
    !(await columnExists(sequelize, table, "is_pos_visible"))
  ) {
    await sequelize.query(
      `ALTER TABLE ${table} CHANGE COLUMN pos_visible is_pos_visible TINYINT(1) NOT NULL DEFAULT 1`
    )
  }
  if (
    (await columnExists(sequelize, table, "web_visible")) &&
    !(await columnExists(sequelize, table, "is_web_visible"))
  ) {
    await sequelize.query(
      `ALTER TABLE ${table} CHANGE COLUMN web_visible is_web_visible TINYINT(1) NOT NULL DEFAULT 1`
    )
  }
}

async function addColumn(sequelize, table, column, definition) {
  if (!(await columnExists(sequelize, table, column))) {
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize

  await renameVisibility(sequelize, "categories")
  await renameVisibility(sequelize, "products")

  for (const table of CATALOG_TABLES) {
    await addColumn(
      sequelize,
      table,
      "is_pos_visible",
      "TINYINT(1) NOT NULL DEFAULT 1"
    )
    await addColumn(
      sequelize,
      table,
      "is_web_visible",
      "TINYINT(1) NOT NULL DEFAULT 1"
    )
    await addColumn(
      sequelize,
      table,
      "channel",
      "ENUM('web','pos','both') NOT NULL DEFAULT 'both'"
    )
  }

  await addColumn(sequelize, "orders", "is_pos_visible", "TINYINT(1) NOT NULL DEFAULT 1")
  await addColumn(sequelize, "orders", "is_web_visible", "TINYINT(1) NOT NULL DEFAULT 1")
  await sequelize.query(`
    UPDATE orders
    SET is_pos_visible = CASE WHEN channel = 'pos' THEN 1 ELSE 0 END,
        is_web_visible = CASE WHEN channel = 'web' THEN 1 ELSE 0 END
  `)

  for (const table of SALE_TABLES) {
    await addColumn(sequelize, table, "is_pos_visible", "TINYINT(1) NOT NULL DEFAULT 1")
    await addColumn(sequelize, table, "is_web_visible", "TINYINT(1) NOT NULL DEFAULT 1")
    await addColumn(sequelize, table, "channel", "ENUM('web','pos') NOT NULL DEFAULT 'pos'")
  }

  await sequelize.query(`
    UPDATE order_items oi
    INNER JOIN orders o ON o.id = oi.order_id
    SET oi.channel = o.channel,
        oi.is_pos_visible = o.is_pos_visible,
        oi.is_web_visible = o.is_web_visible
  `)
  await sequelize.query(`
    UPDATE payments p
    INNER JOIN orders o ON o.id = p.order_id
    SET p.channel = o.channel,
        p.is_pos_visible = o.is_pos_visible,
        p.is_web_visible = o.is_web_visible
  `)
  await sequelize.query(`
    UPDATE receipts r
    INNER JOIN orders o ON o.id = r.order_id
    SET r.channel = o.channel,
        r.is_pos_visible = o.is_pos_visible,
        r.is_web_visible = o.is_web_visible
  `)
  await sequelize.query(`
    UPDATE order_refunds rf
    INNER JOIN orders o ON o.id = rf.order_id
    SET rf.channel = o.channel,
        rf.is_pos_visible = o.is_pos_visible,
        rf.is_web_visible = o.is_web_visible
  `)
  await sequelize.query(`
    UPDATE order_refund_items ri
    INNER JOIN order_refunds rf ON rf.id = ri.refund_id
    SET ri.channel = rf.channel,
        ri.is_pos_visible = rf.is_pos_visible,
        ri.is_web_visible = rf.is_web_visible
  `)

  await sequelize.query(`
    UPDATE products
    SET channel = CASE
      WHEN is_pos_visible = 1 AND is_web_visible = 1 THEN 'both'
      WHEN is_pos_visible = 1 THEN 'pos'
      ELSE 'web'
    END
  `)
  await sequelize.query(`
    UPDATE categories
    SET channel = CASE
      WHEN is_pos_visible = 1 AND is_web_visible = 1 THEN 'both'
      WHEN is_pos_visible = 1 THEN 'pos'
      ELSE 'web'
    END
  `)
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  for (const table of SALE_TABLES) {
    for (const col of ["channel", "is_web_visible", "is_pos_visible"]) {
      if (await columnExists(sequelize, table, col)) {
        await sequelize.query(`ALTER TABLE ${table} DROP COLUMN ${col}`)
      }
    }
  }
  for (const col of ["is_web_visible", "is_pos_visible"]) {
    if (await columnExists(sequelize, "orders", col)) {
      await sequelize.query(`ALTER TABLE orders DROP COLUMN ${col}`)
    }
  }
  for (const table of CATALOG_TABLES) {
    if (table === "categories" || table === "products") {
      if (await columnExists(sequelize, table, "channel")) {
        await sequelize.query(`ALTER TABLE ${table} DROP COLUMN channel`)
      }
      if (
        (await columnExists(sequelize, table, "is_pos_visible")) &&
        !(await columnExists(sequelize, table, "pos_visible"))
      ) {
        await sequelize.query(
          `ALTER TABLE ${table} CHANGE COLUMN is_pos_visible pos_visible TINYINT(1) NOT NULL DEFAULT 1`
        )
      }
      if (
        (await columnExists(sequelize, table, "is_web_visible")) &&
        !(await columnExists(sequelize, table, "web_visible"))
      ) {
        await sequelize.query(
          `ALTER TABLE ${table} CHANGE COLUMN is_web_visible web_visible TINYINT(1) NOT NULL DEFAULT 1`
        )
      }
      continue
    }
    for (const col of ["channel", "is_web_visible", "is_pos_visible"]) {
      if (await columnExists(sequelize, table, col)) {
        await sequelize.query(`ALTER TABLE ${table} DROP COLUMN ${col}`)
      }
    }
  }
}
