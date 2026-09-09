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
  categories: { table: "categories", cascade: [] },
  products: {
    table: "products",
    cascade: [
      { table: "product_stocks", fk: "product_id" },
      { table: "product_bulk_tiers", fk: "product_id" },
      { table: "reviews", fk: "product_id" },
    ],
  },
  product_stocks: { table: "product_stocks", cascade: [] },
  customers: {
    table: "customers",
    cascade: [{ table: "customer_credit_entries", fk: "customer_id" }],
  },
  suppliers: {
    table: "suppliers",
    cascade: [{ table: "supplier_ledger", fk: "supplier_id" }],
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
