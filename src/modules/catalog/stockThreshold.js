/*
 * The unit a low_stock_threshold is written in follows what the product is sold in:
 *   only sold by the pack (is_pack_product, sell_loose = false) -> "pack"  (compared with qty / pack_size)
 *   anything else (loose, pack + loose, weight based)           -> "unit"  (piece / gram / kg; compared with qty)
 * Stock itself is always kept in units; only the comparison changes.
 */

export function thresholdUnit(row) {
  const size = Number(row?.pack_size)
  return row?.is_pack_product && size >= 2 && row.sell_loose === false ? "pack" : "unit"
}

/** The qty in the unit of the threshold: whole and part packs for a pack-only product, else the qty. */
export function qtyForThreshold(qty, row) {
  return thresholdUnit(row) === "pack" ? Number(qty) / Number(row.pack_size) : Number(qty)
}

/** At or under the threshold (false without one). */
export function isLowStock(qty, threshold, row) {
  if (threshold == null || threshold === "") return false
  return qtyForThreshold(qty, row) <= Number(threshold)
}
