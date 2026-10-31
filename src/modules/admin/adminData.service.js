import { sequelize } from "../../db/sequelize.js"
import { AppError } from "../../shared/errors/AppError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

const KEEP_ON_FULL_WIPE = new Set(["sequelizemeta"])

export const DATA_MODULES = {
  orders: {
    table: "orders",
    cascade: [
      { table: "order_refund_items", join: { table: "order_refunds", from: "refund_id", on: "id", fk: "order_id" } },
      { table: "order_refunds", fk: "order_id" },
      { table: "order_items", fk: "order_id" },
      { table: "payments", fk: "order_id" },
      { table: "receipts", fk: "order_id" },
      { table: "coupon_redemptions", fk: "order_id" },
    ],
  },
  order_items: { table: "order_items", cascade: [] },
  order_refunds: {
    table: "order_refunds",
    cascade: [{ table: "order_refund_items", fk: "refund_id" }],
  },
  payments: { table: "payments", cascade: [] },
  receipts: { table: "receipts", cascade: [] },
  categories: {
    table: "categories",
    cascade: [{ table: "category_locations", fk: "category_id" }],
  },
  products: {
    table: "products",
    cascade: [
      { table: "product_stocks", fk: "product_id" },
      { table: "product_bulk_tiers", fk: "product_id" },
      { table: "reviews", fk: "product_id" },
      { table: "product_locations", fk: "product_id" },
    ],
  },
  product_stocks: { table: "product_stocks", cascade: [] },
  customers: {
    table: "customers",
    cascade: [{ table: "customer_credit_entries", fk: "customer_id" }],
  },
  suppliers: {
    table: "suppliers",
    cascade: [
      { table: "supplier_ledger", fk: "supplier_id" },
      { table: "supplier_locations", fk: "supplier_id" },
    ],
  },
  stock_movements: { table: "stock_movements", cascade: [] },
  stock_transfers: { table: "stock_transfers", cascade: [] },
  offers: {
    table: "offers",
    cascade: [{ table: "offer_targets", fk: "offer_id" }],
  },
  coupons: {
    table: "coupons",
    cascade: [{ table: "coupon_redemptions", fk: "coupon_id" }],
  },
  carts: {
    table: "carts",
    cascade: [{ table: "cart_items", fk: "cart_id" }],
  },
  addresses: { table: "addresses", cascade: [] },
  reviews: { table: "reviews", cascade: [] },
  staff: { table: "users", cascade: [{ table: "auth_tokens", fk: "user_id" }] },
  users: { table: "users", cascade: [{ table: "auth_tokens", fk: "user_id" }] },
  stores: { table: "stores", cascade: [] },
  locations: { table: "locations", cascade: [] },
  plans: { table: "plans", cascade: [] },
  licenses: { table: "store_licenses", cascade: [] },
  pos_devices: { table: "pos_devices", cascade: [] },
  register_sessions: { table: "register_sessions", cascade: [] },
  billings: { table: "billings", cascade: [] },
  store_banners: { table: "store_banners", cascade: [] },
  audit_logs: { table: "audit_logs", cascade: [] },
  approval_requests: { table: "approval_requests", cascade: [] },
}

function moduleConfig(name) {
  const key = String(name || "").trim()
  const config = DATA_MODULES[key]
  if (!config) {
    throw new AppError(
      `Unknown module '${key}'. Allowed: ${Object.keys(DATA_MODULES).join(", ")}`,
      400
    )
  }
  return { key, ...config }
}

function affected(result) {
  if (!result) return 0
  if (typeof result.affectedRows === "number") return result.affectedRows
  if (Array.isArray(result) && result[0] && typeof result[0].affectedRows === "number") {
    return result[0].affectedRows
  }
  return 0
}

async function execDelete(sql, replacements) {
  const [result] = await sequelize.query(sql, { replacements })
  return affected(result)
}

async function withFkOff(fn) {
  await sequelize.query("SET FOREIGN_KEY_CHECKS = 0")
  try {
    return await fn()
  } finally {
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 1")
  }
}

async function wipeTable(table) {
  return execDelete(`DELETE FROM \`${table}\``)
}

async function deleteCascadeRows(config, ids) {
  let deleted = 0
  for (const child of config.cascade) {
    if (child.join) {
      deleted += await execDelete(
        `DELETE child FROM \`${child.table}\` AS child
         INNER JOIN \`${child.join.table}\` AS parent
           ON parent.\`${child.join.on}\` = child.\`${child.join.from}\`
         WHERE parent.\`${child.join.fk}\` IN (:ids)`,
        { ids }
      )
    } else {
      deleted += await execDelete(
        `DELETE FROM \`${child.table}\` WHERE \`${child.fk}\` IN (:ids)`,
        { ids }
      )
    }
  }
  deleted += await execDelete(
    `DELETE FROM \`${config.table}\` WHERE id IN (:ids)`,
    { ids }
  )
  return deleted
}

export function listDataModules() {
  return Object.entries(DATA_MODULES).map(([name, config]) => ({
    name,
    table: config.table,
    cascade: config.cascade.map((row) => row.table),
  }))
}

export async function deleteAllDbData() {
  const cleared = await withFkOff(async () => {
    const [tables] = await sequelize.query("SHOW TABLES")
    const names = tables.map((row) => Object.values(row)[0])
    const wiped = []
    for (const table of names) {
      if (KEEP_ON_FULL_WIPE.has(String(table).toLowerCase())) continue
      const count = await wipeTable(table)
      wiped.push({ table, deleted: count })
    }
    return wiped
  })

  return { wiped: cleared }
}

export async function deleteModuleAll(moduleName) {
  const config = moduleConfig(moduleName)
  const wiped = await withFkOff(async () => {
    const rows = []
    for (const child of config.cascade) {
      rows.push({ table: child.table, deleted: await wipeTable(child.table) })
    }
    rows.push({ table: config.table, deleted: await wipeTable(config.table) })
    return rows
  })
  return { module: config.key, wiped }
}

export async function deleteModuleById(moduleName, id) {
  const config = moduleConfig(moduleName)
  const deleted = await withFkOff(() => deleteCascadeRows(config, [id]))
  if (!deleted) throw new NotFoundError(`${config.key} row not found`)
  return { module: config.key, id, deleted }
}

export async function bulkDeleteModule(moduleName, ids) {
  const config = moduleConfig(moduleName)
  const unique = [...new Set(ids)]
  const deleted = await withFkOff(() => deleteCascadeRows(config, unique))
  return { module: config.key, ids: unique, deleted }
}

// Tables without a store_id, cleaned through their parent row.
const STORE_CHILD_TABLES = [
  ["order_items", "order_id", "orders"],
  ["order_refund_items", "refund_id", "order_refunds"],
  ["offer_targets", "offer_id", "offers"],
  ["cart_items", "cart_id", "carts"],
  ["auth_tokens", "user_id", "users"],
  ["user_sessions", "user_id", "users"],
]

/**
 * Deletes one store and every row that belongs to it (all tables with its store_id, their child
 * rows and its counters). Runs on one connection so the foreign-key switch covers every delete.
 */
export async function deleteStoreData(storeId) {
  return sequelize.transaction(async (transaction) => {
    const run = (sql, replacements = []) =>
      sequelize.query(sql, { replacements, transaction })
    await run("SET FOREIGN_KEY_CHECKS = 0")
    try {
      for (const [table, fk, parent] of STORE_CHILD_TABLES) {
        await run(
          `DELETE c FROM \`${table}\` c JOIN \`${parent}\` p ON p.id = c.\`${fk}\` WHERE p.store_id = ?`,
          [storeId]
        )
      }
      const [tables] = await run(
        `SELECT TABLE_NAME AS name FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'store_id' AND TABLE_NAME <> 'stores'`
      )
      for (const { name } of tables) {
        await run(`DELETE FROM \`${name}\` WHERE store_id = ?`, [storeId])
      }
      await run("DELETE FROM counters WHERE name LIKE ?", [`%:${storeId}`])
      await run("DELETE FROM stores WHERE id = ?", [storeId])
    } finally {
      await run("SET FOREIGN_KEY_CHECKS = 1")
    }
    return { store_id: storeId }
  })
}

/**
 * Trial stores whose trial ended more than TRIAL_DECISION_DAYS ago and that never bought a plan
 * are deleted with all their data (runs on the license sweep timer).
 */
export async function deleteExpiredTrialStores() {
  const { Store } = await import("../stores/store.model.js")
  const { Op } = await import("sequelize")
  const { TRIAL_DECISION_DAYS } = await import("../../db/enums.js")
  const cutoff = new Date(Date.now() - TRIAL_DECISION_DAYS * 24 * 60 * 60 * 1000)
  const stores = await Store.findAll({
    where: { status: "trial", trial_ends_at: { [Op.lt]: cutoff } },
    attributes: ["id"],
  })
  for (const store of stores) await deleteStoreData(store.id)
  return stores.length
}
