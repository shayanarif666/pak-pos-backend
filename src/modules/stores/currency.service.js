import { sequelize } from "../../db/sequelize.js"
import { Currency, CURRENCY_DEFAULTS } from "./currency.model.js"
import { getStoreForManager } from "./store.service.js"

function publicCurrency(row) {
  return {
    code: row.code,
    name: row.name,
    symbol: row.symbol,
    decimal_places: row.decimal_places,
    symbol_position: row.symbol_position,
  }
}

/** The store's currency row; a store without one yet shows the PKR defaults. */
export async function getCurrency(storeId) {
  await getStoreForManager(storeId)
  const row = await Currency.findOne({ where: { store_id: storeId } })
  return publicCurrency(row || CURRENCY_DEFAULTS)
}

/** Creates the store's PKR currency row (store registration). */
export async function createDefaultCurrency(store, { transaction } = {}) {
  return Currency.create(
    { store_id: store.id, store_id_int: store.store_id_int, ...CURRENCY_DEFAULTS, code: store.currency || "PKR" },
    { transaction }
  )
}

/** Updates the store's currency (creating the row if the store has none yet). */
export async function putCurrency(storeId, fields) {
  const store = await getStoreForManager(storeId)
  await sequelize.transaction(async (transaction) => {
    const existing = await Currency.findOne({ where: { store_id: storeId }, transaction })
    if (existing) await existing.update(fields, { transaction })
    else {
      await Currency.create(
        { store_id: store.id, store_id_int: store.store_id_int, ...CURRENCY_DEFAULTS, ...fields },
        { transaction }
      )
    }
    // Orders and receipts read stores.currency; keep it on the same code.
    if (fields.code) await store.update({ currency: fields.code }, { transaction })
  })
  return getCurrency(storeId)
}
