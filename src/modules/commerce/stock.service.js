import { applyStockDelta } from "../catalog/productStock.service.js"

export async function deductSaleStock(
  {
    store,
    location,
    productId,
    qty,
    staffId,
    orderId,
    isCustom,
  },
  { transaction }
) {
  if (isCustom) return null
  return applyStockDelta(
    {
      storeId: store.id,
      storeIdInt: store.store_id_int,
      location,
      productId,
      delta: -Number(qty),
      movement_type: "sale",
      reason: "sale",
      staff_id: staffId || null,
      order_id: orderId,
    },
    { transaction }
  )
}

/** The lots to put `units` back into: the lots the sale line took, the last one first, less what already came back. */
function lotsToReturn(item, units) {
  let taken = item?.lots
  if (typeof taken === "string") {
    try {
      taken = JSON.parse(taken)
    } catch {
      taken = null
    }
  }
  if (!Array.isArray(taken) || !taken.length) return { plan: [], lots: null }
  const lots = taken.map((lot) => ({ ...lot }))
  const plan = []
  let left = Number(units)
  for (const lot of [...lots].reverse()) {
    if (left <= 0) break
    const free = Number(lot.qty) - Number(lot.returned || 0)
    if (free <= 0) continue
    const qty = Math.min(free, left)
    plan.push({ lot_id: lot.lot_id, qty, expiry_date: lot.expiry_date || null })
    lot.returned = Math.round((Number(lot.returned || 0) + qty) * 10000) / 10000
    left = Math.round((left - qty) * 10000) / 10000
  }
  return { plan, lots }
}

/** Stock back from a refund / void: into the lots the sale took (item = the order line). */
export async function restockSaleStock(
  {
    store,
    location,
    productId,
    qty,
    staffId,
    orderId,
    isCustom,
    item = null,
  },
  { transaction }
) {
  if (isCustom) return null
  const { plan, lots } = lotsToReturn(item, qty)
  if (lots && item?.update) await item.update({ lots }, { transaction })
  return applyStockDelta(
    {
      storeId: store.id,
      storeIdInt: store.store_id_int,
      location,
      productId,
      delta: Number(qty),
      movement_type: "refund",
      reason: "refund",
      staff_id: staffId || null,
      order_id: orderId,
      return_lots: plan,
    },
    { transaction }
  )
}
