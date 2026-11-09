/*
 * The unit a low_stock_threshold is written in (low_stock_unit) follows what the product is sold in:
 *   only sold by the pack (is_pack_product, sell_loose = false) -> "pack"  (compared with qty / pack_size)
 *   loose or weight based                                       -> "unit"  (piece / gram / kg; compared with qty)
 *   pack + loose                                                -> the choice saved on it (low_stock_unit), default "unit"
 * Stock itself is always kept in units; only the comparison changes.
 */

export function thresholdUnit(row) {
  const size = Number(row?.pack_size)
  if (!(row?.is_pack_product && size >= 2)) return "unit"
  if (row.sell_loose === false) return "pack"
  return row.low_stock_unit === "pack" ? "pack" : "unit"
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
