import { Op } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { StockTransfer } from "./stockTransfer.model.js"
import { StockTransferItem } from "./stockTransferItem.model.js"
import { ProductStock } from "../catalog/productStock.model.js"
import { getProduct, getProductByNumber } from "../catalog/product.service.js"
import { applyStockDelta, loadLocation } from "../catalog/productStock.service.js"
import { getStoreForManager } from "../stores/store.service.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { nextStockTransferNumber } from "../../shared/utils/counter.util.js"

/*
 * A stock transfer is one shipment from one location to one or more destinations, each getting its
 * own products and qty (one stock_transfer_items row per product per destination). Stock moves when
 * a destination receives its part: the source gives up the qty that left, the destination gets what
 * arrived. The transfer is on_the_way until every line is received or cancelled.
 */

const OPEN = ["pending", "on_the_way"]
const itemsInclude = { model: StockTransferItem, as: "items" }
const num = (value) => (value == null ? null : Number(value))

/** The transfer with its lines grouped by destination (plus the old single-line fields). */
export function publicTransfer(row) {
  const json = row.toJSON ? row.toJSON() : row
  const items = [...(json.items || [])].sort((a, b) => a.item_number - b.item_number)
  const destinations = []
  for (const item of items) {
    let dest = destinations.find((d) => d.to_location_id === item.to_location_id)
    if (!dest) {
      dest = { to_location_id: item.to_location_id, status: null, products: [] }
      destinations.push(dest)
    }
    dest.products.push({
      item_number: item.item_number,
      product_id: item.product_id,
      qty: num(item.qty),
      received_qty: num(item.received_qty),
      status: item.status,
      received_at: item.received_at,
      received_by: item.received_by,
      // The lots it left from (and arrived as), once received: [{ lot_id, lot_number, qty, expiry_date }].
      lots: Array.isArray(item.lots) ? item.lots : typeof item.lots === "string" ? JSON.parse(item.lots || "[]") : [],
    })
  }
  for (const dest of destinations) dest.status = groupStatus(dest.products)
  const single = items.length === 1 ? items[0] : null
  return {
    id: json.id,
    store_id: json.store_id,
    transfer_number: json.transfer_number,
    from_location_id: json.from_location_id,
    status: json.status,
    note: json.note,
    created_by: json.created_by,
    created_at: json.created_at,
    updated_at: json.updated_at,
    destinations,
    // A transfer with one product to one place still reads as before.
    to_location_id: single?.to_location_id ?? null,
    product_id: single?.product_id ?? null,
    qty: single ? num(single.qty) : null,
    received_qty: single ? num(single.received_qty) : null,
  }
}

/** on_the_way while any line is; else completed if any arrived, else cancelled. */
function groupStatus(lines) {
  if (lines.some((line) => OPEN.includes(line.status))) return "on_the_way"
  return lines.some((line) => line.status === "completed") ? "completed" : "cancelled"
}

async function refreshStatus(row, transaction) {
  const items = await StockTransferItem.findAll({ where: { transfer_id: row.id }, transaction })
  const status = groupStatus(items)
  if (status !== row.status) await row.update({ status }, { transaction })
}

export async function listTransfers(storeId, { locationId } = {}) {
  const where = { store_id: storeId }
  if (locationId) {
    // From this location, or with a line going to it.
    const incoming = await StockTransferItem.findAll({
      where: { store_id: storeId, to_location_id: locationId },
      attributes: ["transfer_id"],
    })
    where[Op.or] = [{ from_location_id: locationId }, { id: [...new Set(incoming.map((row) => row.transfer_id))] }]
  }
  const rows = await StockTransfer.findAll({ where, include: [itemsInclude], order: [["created_at", "DESC"]] })
  return rows.map(publicTransfer)
}

async function getTransfer(storeId, id, transaction) {
  const row = await StockTransfer.findOne({ where: { id, store_id: storeId }, include: [itemsInclude], transaction })
  if (!row) throw new NotFoundError("Transfer not found")
  return row
}

export async function getTransferView(storeId, id) {
  return publicTransfer(await getTransfer(storeId, id))
}

/**
 * The product a line moves: product_id (number or UUID), and for a product with variants the
 * variant_id (its number inside the product, or UUID) — the variant is what is stocked.
 */
async function productOf(storeId, ref, variantRef = null) {
  const product = /^\d+$/.test(String(ref)) ? await getProductByNumber(storeId, Number(ref)) : await getProduct(storeId, ref)
  if (!variantRef) {
    if (product.has_variants) throw new AppError(`${product.title} has variants: send variant_id`, 400)
    return product
  }
  if (!product.has_variants) throw new AppError(`${product.title} has no variants: leave variant_id out`, 400)
  const variant = (product.variants || []).find(
    (row) => String(row.variant_number) === String(variantRef) || row.id === variantRef
  )
  if (!variant) throw new NotFoundError(`Variant ${variantRef} of ${product.title} not found`)
  return { ...variant.toJSON(), title: variant.title }
}

async function available(locationId, productId, transaction) {
  const stock = await ProductStock.findOne({ where: { location_id: locationId, product_id: productId }, transaction })
  return Number(stock?.qty || 0)
}

/**
 * Creates one transfer: from one location to every destination with its own products and qty.
 * The source must hold, per product, the qty of every destination together.
 */
export async function createTransfer(storeId, fields, actor) {
  await getStoreForManager(storeId)
  const from = await loadLocation(storeId, fields.from_location_id)
  const lines = await buildLines(storeId, from, fields.destinations)

  const id = await sequelize.transaction(async (transaction) => {
    const row = await StockTransfer.create(
      {
        store_id: storeId,
        transfer_number: await nextStockTransferNumber(storeId, transaction),
        from_location_id: from.id,
        note: fields.note,
        // Sent from the source; stock moves when each destination receives its part.
        status: "on_the_way",
        created_by: actor.id,
      },
      { transaction }
    )
    await StockTransferItem.bulkCreate(lineRows(storeId, row.id, lines), { transaction })
    return row.id
  })
  return getTransferView(storeId, id)
}

function lineRows(storeId, transferId, lines) {
  return lines.map((line, index) => ({
    store_id: storeId,
    transfer_id: transferId,
    item_number: index + 1,
    to_location_id: line.to_location_id,
    product_id: line.product_id,
    qty: line.qty,
    status: "on_the_way",
  }))
}

/**
 * The lines of a transfer from `from` (one per product per destination) after checking the source
 * holds, per product, the qty of every destination together.
 */
async function buildLines(storeId, from, destinations) {
  const lines = []
  const totalByProduct = new Map()
  for (const dest of destinations) {
    const to = await loadLocation(storeId, dest.to_location_id)
    if (to.id === from.id) throw new ConflictError("A destination cannot be the location the stock leaves from")
    for (const row of dest.products) {
      const product = await productOf(storeId, row.product_id, row.variant_id)
      const existing = lines.find((line) => line.to_location_id === to.id && line.product_id === product.id)
      if (existing) existing.qty += row.qty
      else lines.push({ to_location_id: to.id, product_id: product.id, title: product.title, qty: row.qty })
      totalByProduct.set(product.id, (totalByProduct.get(product.id) || 0) + row.qty)
    }
  }
  // Reject up front instead of letting an impossible transfer sit on the way.
  for (const [productId, qty] of totalByProduct) {
    const have = await available(from.id, productId)
    if (qty > have) {
      const title = lines.find((line) => line.product_id === productId)?.title || "a product"
      throw new ConflictError(`Only ${have} of ${title} available at the source location (${qty} sent)`)
    }
  }
  return lines
}

/** No stock has moved yet: nothing of it was received (every line on the way or cancelled). */
function assertNothingReceived(row, action) {
  if ((row.items || []).some((item) => item.status === "completed")) {
    throw new ConflictError(`Part of transfer ${row.transfer_number} has been received, so its stock has moved: it cannot be ${action}`)
  }
}

/**
 * One row of PATCH /stock-transfers/bulk — the same fields as create: from_location_id, note,
 * destinations. destinations replace every product on the way (as if the transfer were sent again);
 * left out, the products stay and only the source / note change. Only a transfer nothing of which
 * has been received can change (its stock has not moved yet).
 */
export async function replaceTransfer(storeId, id, fields) {
  await getStoreForManager(storeId)
  const row = await getTransfer(storeId, id)
  assertNothingReceived(row, "changed")
  const open = (row.items || []).filter((item) => OPEN.includes(item.status))
  if (!open.length && !fields.destinations) throw new ConflictError("A cancelled transfer can only change by sending its destinations again")
  const from = fields.from_location_id ? await loadLocation(storeId, fields.from_location_id) : await loadLocation(storeId, row.from_location_id)

  let lines = null
  if (fields.destinations) {
    lines = await buildLines(storeId, from, fields.destinations)
  } else if (from.id !== row.from_location_id) {
    // Same products from another source: it must not be one of the destinations, and must hold them.
    if (open.some((item) => item.to_location_id === from.id)) {
      throw new ConflictError("A destination cannot be the location the stock leaves from")
    }
    const destinations = []
    for (const item of open) {
      let dest = destinations.find((d) => d.to_location_id === item.to_location_id)
      if (!dest) destinations.push((dest = { to_location_id: item.to_location_id, products: [] }))
      dest.products.push({ product_id: item.product_id, qty: Number(item.qty) })
    }
    lines = await buildLines(storeId, from, destinations)
  }

  await sequelize.transaction(async (transaction) => {
    if (lines) {
      // Nothing moved yet, so the old lines are simply replaced by the new ones.
      await StockTransferItem.destroy({ where: { transfer_id: row.id }, transaction })
      await StockTransferItem.bulkCreate(lineRows(storeId, row.id, lines), { transaction })
    }
    await row.update(
      {
        from_location_id: from.id,
        ...(fields.note !== undefined ? { note: fields.note } : {}),
        ...(lines ? { status: "on_the_way" } : {}),
      },
      { transaction }
    )
  })
  return getTransferView(storeId, id)
}

/**
 * DELETE /stock-transfers/:id — soft delete: the transfer leaves every list and the POS; its rows
 * stay. Only one nothing of which has been received (its stock has not moved).
 */
export async function deleteTransfer(storeId, id) {
  const row = await getTransfer(storeId, id)
  assertNothingReceived(row, "deleted")
  const view = publicTransfer(row)
  await row.destroy()
  const deleted = await StockTransfer.findOne({ where: { id: row.id }, paranoid: false, attributes: ["deleted_at"] })
  return { view, deleted_at: deleted?.deleted_at || new Date() }
}

/** The lines a request acts on: a destination's (or all), optionally only some products. */
async function pickLines(storeId, row, { to_location_id, products }, actor) {
  let lines = (row.items || []).filter((item) => OPEN.includes(item.status))
  let toId = null
  if (to_location_id) toId = (await loadLocation(storeId, to_location_id)).id
  else if (actor && actor.role !== "store_admin" && actor.location_id) toId = actor.location_id
  if (actor && actor.role !== "store_admin" && toId && toId !== actor.location_id) {
    throw new ForbiddenError("You can only receive or change the stock coming to your own location")
  }
  if (toId) lines = lines.filter((item) => item.to_location_id === toId)
  if (products?.length) {
    const wanted = []
    for (const entry of products) {
      const product = await productOf(storeId, entry.product_id, entry.variant_id)
      const line = lines.find((item) => item.product_id === product.id)
      if (!line) throw new NotFoundError(`${product.title} is not on the way${toId ? " to this location" : ""}`)
      wanted.push({ line, entry })
    }
    return wanted
  }
  return lines.map((line) => ({ line, entry: null }))
}

export async function completeTransfer(storeId, id, actor) {
  return receiveTransfer(storeId, id, actor, {})
}

/**
 * A destination receives its part. received_qty per product = what actually arrived (default: all
 * of it); the source gives up the full qty that left, so a shortfall shows as the difference and is
 * noted on the transfer.
 */
export async function receiveTransfer(storeId, id, actor, { to_location_id, products, received_qty, note } = {}) {
  const store = await getStoreForManager(storeId)
  const row = await getTransfer(storeId, id)
  const picked = await pickLines(storeId, row, { to_location_id, products }, actor)
  if (!picked.length) throw new ConflictError("Nothing on the way to receive")
  if (received_qty !== undefined && !products && picked.length > 1) {
    throw new AppError("This transfer has several products: send products [{ product_id, received_qty }]", 400)
  }
  const from = await loadLocation(storeId, row.from_location_id)
  const shortNotes = []

  await sequelize.transaction(async (transaction) => {
    for (const { line, entry } of picked) {
      const qty = Number(line.qty)
      const received = entry ? entry.received_qty : received_qty === undefined ? qty : Number(received_qty)
      if (Number.isNaN(received) || received < 0 || received > qty) {
        throw new AppError(`received_qty must be between 0 and ${qty}`, 400)
      }
      if ((await available(from.id, line.product_id, transaction)) < qty) {
        throw new ConflictError("Insufficient stock at source location")
      }
      const to = await loadLocation(storeId, line.to_location_id)
      const short = Number((qty - received).toFixed(4))
      const lineNote = short > 0 ? `Line ${line.item_number}: received ${received} of ${qty} (${short} short)` : null
      if (lineNote) shortNotes.push(lineNote)
      const movementNote = [row.note, note, lineNote].filter(Boolean).join(" — ") || null
      // It leaves the source from the lots that expire first (FEFO)…
      const out = await applyStockDelta(
        {
          storeId,
          storeIdInt: store.store_id_int,
          location: from,
          productId: line.product_id,
          delta: -qty,
          movement_type: "transfer_out",
          reason: "transfer",
          reason_note: movementNote,
          staff_id: actor.id,
        },
        { transaction }
      )
      // …and arrives as lots with the same expiry dates (a shortfall comes off the last lots).
      const left = (out.lots || []).map((lot) => ({ ...lot, qty: Math.abs(lot.qty) }))
      let toArrive = received
      const parts = []
      for (const lot of left) {
        if (toArrive <= 0) break
        const part = Math.min(lot.qty, toArrive)
        parts.push({ qty: part, expiry_date: lot.expiry_date })
        toArrive = Number((toArrive - part).toFixed(4))
      }
      if (toArrive > 0) parts.push({ qty: toArrive, expiry_date: undefined })
      for (const part of parts) {
        await applyStockDelta(
          {
            storeId,
            storeIdInt: store.store_id_int,
            location: to,
            productId: line.product_id,
            delta: part.qty,
            movement_type: "transfer_in",
            reason: "transfer",
            reason_note: movementNote,
            staff_id: actor.id,
            ...(part.expiry_date !== undefined ? { expiry_date: part.expiry_date } : {}),
          },
          { transaction }
        )
      }
      await line.update(
        { status: "completed", received_qty: received, received_at: new Date(), received_by: actor.id, lots: left.length ? left : null },
        { transaction }
      )
    }
    const extra = [note, ...shortNotes].filter(Boolean)
    if (extra.length) await row.update({ note: [row.note, ...extra].filter(Boolean).join(" — ") }, { transaction })
    await refreshStatus(row, transaction)
  })
  return getTransferView(storeId, id)
}

/** Cancel what is still on the way: the whole transfer, one destination, or some products. */
export async function cancelTransfer(storeId, id, { to_location_id, products } = {}, actor = null) {
  await getStoreForManager(storeId)
  const row = await getTransfer(storeId, id)
  const picked = await pickLines(storeId, row, { to_location_id, products }, actor?.role === "store_admin" ? null : actor)
  if (!picked.length) throw new ConflictError("Only stock still on the way can be cancelled")
  await sequelize.transaction(async (transaction) => {
    for (const { line } of picked) await line.update({ status: "cancelled" }, { transaction })
    await refreshStatus(row, transaction)
  })
  return getTransferView(storeId, id)
}

/**
 * Change what is still on the way: the note, a line's qty (products [{ product_id, to_location_id?, qty }]),
 * or — for a transfer with one product — qty / to_location_id as before.
 */
export async function updateTransfer(storeId, id, fields) {
  const row = await getTransfer(storeId, id)
  const open = (row.items || []).filter((item) => OPEN.includes(item.status))
  if (!open.length) throw new ConflictError("Only a transfer on the way can be changed")
  const changes = []

  if (Array.isArray(fields.products)) {
    for (const entry of fields.products) {
      const product = await productOf(storeId, entry.product_id ?? entry.productId)
      let lines = open.filter((item) => item.product_id === product.id)
      const toRef = entry.to_location_id ?? entry.toLocationId
      if (toRef) {
        const to = await loadLocation(storeId, toRef)
        lines = lines.filter((item) => item.to_location_id === to.id)
      }
      if (lines.length !== 1) {
        throw new AppError(`${product.title}: name its to_location_id (it goes to ${lines.length || "no"} open destinations)`, 400)
      }
      const qty = Number(entry.qty)
      if (Number.isNaN(qty) || qty <= 0) throw new AppError("qty must be a number > 0", 400)
      changes.push({ line: lines[0], patch: { qty } })
    }
  } else if (fields.qty !== undefined || fields.to_location_id !== undefined) {
    if (open.length !== 1) {
      throw new AppError("This transfer has several products: send products [{ product_id, to_location_id, qty }]", 400)
    }
    const patch = {}
    if (fields.qty !== undefined) {
      const qty = Number(fields.qty)
      if (Number.isNaN(qty) || qty <= 0) throw new AppError("qty must be a number > 0", 400)
      patch.qty = qty
    }
    if (fields.to_location_id !== undefined) {
      const to = await loadLocation(storeId, fields.to_location_id)
      if (to.id === row.from_location_id) throw new ConflictError("A destination cannot be the location the stock leaves from")
      patch.to_location_id = to.id
    }
    changes.push({ line: open[0], patch })
  }

  // The source must still hold every product's open qty after the change.
  const totals = new Map()
  for (const item of open) {
    const change = changes.find((c) => c.line.id === item.id)
    totals.set(item.product_id, (totals.get(item.product_id) || 0) + Number(change?.patch.qty ?? item.qty))
  }
  for (const [productId, qty] of totals) {
    const have = await available(row.from_location_id, productId)
    if (qty > have) throw new ConflictError(`Only ${have} available at the source location`)
  }

  const note = fields.note === undefined ? undefined : fields.note == null ? null : String(fields.note).trim()
  if (!changes.length && note === undefined) throw new AppError("Send products, qty, to_location_id or note", 400)
  await sequelize.transaction(async (transaction) => {
    for (const { line, patch } of changes) await line.update(patch, { transaction })
    if (note !== undefined) await row.update({ note }, { transaction })
  })
  return getTransferView(storeId, id)
}
