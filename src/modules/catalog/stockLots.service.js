import { Op } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { StockLot } from "./stockLot.model.js"
import { nextStockLotNumber } from "../../shared/utils/counter.util.js"
import { AppError } from "../../shared/errors/AppError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

/*
 * Stock lots — a product's stock at a location in parts, each with its own expiry date.
 *   stock in  → a lot: the one sent (lot_id), else the one with the same expiry date, else a new one
 *               (no expiry date given: the latest lot, else a new lot without expiry)
 *   stock out → from the lot sent, else the lot that expires first (FEFO: by expiry date, lots
 *               without one last, then the oldest)
 *   refund    → back into the lots the sale took from
 * product_stocks.qty stays the total; its expiry_date is the soonest expiry still in stock.
 */

const round4 = (value) => Math.round(Number(value) * 10000) / 10000
// FEFO: the soonest expiry first, lots without one last, then the oldest.
const FEFO = [
  [sequelize.literal("expiry_date IS NULL"), "ASC"],
  ["expiry_date", "ASC"],
  ["received_at", "ASC"],
  ["lot_number", "ASC"],
]

export function lotSource(movement_type, reason) {
  if (reason === "opening_balance") return "opening"
  if (reason === "purchase") return "purchase"
  if (reason === "transfer" || movement_type === "transfer_in") return "transfer"
  if (reason === "refund" || movement_type === "refund") return "refund"
  if (movement_type === "adjustment") return "adjustment"
  return "stock_in"
}

/** The lots of a product at a location that are not deleted, soonest expiry first. */
export function lotsOf(locationId, productId, transaction, { withEmpty = false } = {}) {
  return StockLot.findAll({
    where: {
      location_id: locationId,
      product_id: productId,
      deleted_at: null,
      ...(withEmpty ? {} : { qty: { [Op.gt]: 0 } }),
    },
    order: FEFO,
    transaction,
    lock: transaction ? transaction.LOCK.UPDATE : undefined,
  })
}

/**
 * A lot by its number (1, 2, 3… — the product's own, so productId is needed) or UUID, in this
 * store (optionally: this product at this location).
 */
export async function findLot(storeId, ref, { locationId, productId, transaction } = {}) {
  const value = String(ref ?? "").trim()
  if (!value) return null
  const byNumber = /^\d+$/.test(value)
  if (byNumber && !productId) throw new AppError(`Lot ${value}: send the product (lot numbers are per product)`, 400)
  const where = byNumber ? { store_id: storeId, product_id: productId, lot_number: Number(value) } : { store_id: storeId, id: value }
  where.deleted_at = null
  const lot = await StockLot.findOne({ where, transaction, lock: transaction ? transaction.LOCK.UPDATE : undefined })
  if (!lot) throw new NotFoundError(`Lot ${value} not found`)
  if ((locationId && lot.location_id !== locationId) || (productId && lot.product_id !== productId)) {
    throw new AppError(`Lot ${lot.lot_number} is not this product's stock at this location`, 400)
  }
  return lot
}

async function newLot({ storeId, storeIdInt, location, productId, qty, expiry, source, receivedAt }, transaction) {
  return StockLot.create(
    {
      store_id: storeId,
      store_id_int: storeIdInt,
      lot_number: await nextStockLotNumber(productId, transaction),
      location_id: location.id,
      location_id_int: location.location_id_int ?? null,
      product_id: productId,
      qty: round4(qty),
      expiry_date: expiry || null,
      received_at: receivedAt || new Date(),
      source,
    },
    { transaction }
  )
}

/** A date (Date or string) as YYYY-MM-DD; null stays null, undefined stays undefined. */
const day = (value) => (value === undefined ? undefined : value == null || value === "" ? null : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10))

const take = (lot, qty) => ({ lot_id: lot.id, lot_number: lot.lot_number, qty: round4(qty), expiry_date: lot.expiry_date || null })

/**
 * Moves `delta` units in the lots of a product at a location; returns the lots moved
 * [{ lot_id, lot_number, qty (signed), expiry_date }].
 *   lotRef      a lot to use (number or UUID)
 *   expiry      undefined = not given; null / "YYYY-MM-DD" = the lot of that expiry (stock in)
 *   returnTo    refund: [{ lot_id, qty }] the sale took — put back there first
 */
export async function moveLots(
  { storeId, storeIdInt, location, productId, delta, lotRef, expiry, returnTo, source, receivedAt },
  transaction
) {
  const amount = round4(delta)
  expiry = day(expiry)
  const moved = []
  const ctx = { storeId, storeIdInt, location, productId, source, receivedAt }

  if (amount > 0) {
    let left = amount
    // A refund goes back into the lots the sale took from (a lot deleted since: a new lot).
    for (const back of returnTo || []) {
      if (left <= 0) break
      const qty = Math.min(left, Number(back.qty) || 0)
      if (qty <= 0) continue
      let lot = await StockLot.findOne({ where: { id: back.lot_id, location_id: location.id, product_id: productId }, transaction, lock: transaction.LOCK.UPDATE })
      if (lot && lot.deleted_at) {
        await lot.update({ deleted_at: null, qty: 0 }, { transaction })
      }
      if (!lot) lot = await newLot({ ...ctx, qty: 0, expiry: back.expiry_date || null }, transaction)
      await lot.update({ qty: round4(Number(lot.qty) + qty) }, { transaction })
      moved.push(take(lot, qty))
      left = round4(left - qty)
    }
    if (left > 0) {
      let lot = null
      if (lotRef) lot = await findLot(storeId, lotRef, { locationId: location.id, productId, transaction })
      else if (expiry !== undefined) {
        lot = await StockLot.findOne({
          where: { location_id: location.id, product_id: productId, deleted_at: null, expiry_date: expiry || null },
          order: [["received_at", "DESC"]],
          transaction,
          lock: transaction.LOCK.UPDATE,
        })
      } else {
        // No expiry given: the latest lot (a count, a correction), else a new lot without one.
        lot = await StockLot.findOne({
          where: { location_id: location.id, product_id: productId, deleted_at: null },
          order: [["received_at", "DESC"], ["lot_number", "DESC"]],
          transaction,
          lock: transaction.LOCK.UPDATE,
        })
      }
      if (lot) await lot.update({ qty: round4(Number(lot.qty) + left) }, { transaction })
      else lot = await newLot({ ...ctx, qty: left, expiry: expiry ?? null }, transaction)
      moved.push(take(lot, left))
    }
    return moved
  }

  if (amount < 0) {
    let need = -amount
    if (lotRef) {
      const lot = await findLot(storeId, lotRef, { locationId: location.id, productId, transaction })
      if (Number(lot.qty) + 1e-6 < need) {
        throw new AppError(`Lot ${lot.lot_number} has only ${round4(lot.qty)} left (${need} taken)`, 400)
      }
      await lot.update({ qty: round4(Number(lot.qty) - need) }, { transaction })
      return [take(lot, -need)]
    }
    for (const lot of await lotsOf(location.id, productId, transaction)) {
      if (need <= 0) break
      const qty = Math.min(need, Number(lot.qty))
      await lot.update({ qty: round4(Number(lot.qty) - qty) }, { transaction })
      moved.push(take(lot, -qty))
      need = round4(need - qty)
    }
    // Older stock without lots: the rest leaves without one (the total is checked by the caller).
    return moved
  }
  return moved
}

/** A new expiry date for one lot (the one sent, else the one that expires first). */
export async function setLotExpiry({ storeId, location, productId, lotRef, expiry: rawExpiry }, transaction) {
  const expiry = day(rawExpiry)
  const lot = lotRef
    ? await findLot(storeId, lotRef, { locationId: location.id, productId, transaction })
    : (await lotsOf(location.id, productId, transaction))[0]
  if (!lot) return null
  await lot.update({ expiry_date: expiry || null }, { transaction })
  return lot
}

/** The soonest expiry date still in stock at this location (null when none). */
export async function soonestExpiry(locationId, productId, transaction) {
  const lot = await StockLot.findOne({
    where: { location_id: locationId, product_id: productId, deleted_at: null, qty: { [Op.gt]: 0 }, expiry_date: { [Op.ne]: null } },
    order: [["expiry_date", "ASC"]],
    transaction,
  })
  return lot ? lot.expiry_date : null
}

const daysUntil = (date, now = new Date()) => {
  if (!date) return null
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  return Math.round((new Date(`${String(date).slice(0, 10)}T00:00:00`) - today) / 86400000)
}

/** expired | critical | warning | ok (null without an expiry date). */
export function lotExpiryStatus(expiry, store) {
  const left = daysUntil(expiry)
  if (left == null) return null
  if (left < 0) return "expired"
  if (left <= Number(store?.expiry_critical_days ?? 7)) return "critical"
  if (left <= Number(store?.expiry_warning_days ?? 30)) return "warning"
  return "ok"
}

/** A lot in a reply: { id (lot number), qty, expiry_date, days_left, expiry_status, received_at, source }. */
export function publicLot(lot, store = null) {
  return {
    id: lot.lot_number,
    qty: round4(lot.qty),
    expiry_date: lot.expiry_date || null,
    days_left: daysUntil(lot.expiry_date),
    expiry_status: lotExpiryStatus(lot.expiry_date, store),
    received_at: lot.received_at,
    source: lot.source,
  }
}

/** Lots by "locationId|productId" for these stock rows (in stock, not deleted, soonest first). */
export async function lotsByStock(rows) {
  const pairs = rows.filter(Boolean).map((row) => ({ location_id: row.location_id, product_id: row.product_id }))
  if (!pairs.length) return new Map()
  const lots = await StockLot.findAll({
    where: {
      deleted_at: null,
      qty: { [Op.gt]: 0 },
      location_id: { [Op.in]: [...new Set(pairs.map((p) => p.location_id))] },
      product_id: { [Op.in]: [...new Set(pairs.map((p) => p.product_id))] },
    },
    order: FEFO,
  })
  const out = new Map()
  for (const lot of lots) {
    const k = `${lot.location_id}|${lot.product_id}`
    if (!out.has(k)) out.set(k, [])
    out.get(k).push(lot)
  }
  return out
}
