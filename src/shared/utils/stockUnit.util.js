import { AppError } from "../errors/AppError.js"

/**
 * stock_unit of a stock row: what its qty counts — "unit" (loose items, the default) or "pack"
 * (whole packs of a pack product). Stock is always kept in loose items.
 */
export function parseStockUnit(value, label) {
  if (value === undefined || value === null || value === "") return "unit"
  const unit = String(value).trim().toLowerCase()
  if (!["unit", "pack"].includes(unit)) throw new AppError(`${label} must be unit or pack`, 400)
  return unit
}

/** The qty in loose items: packs × pack_size for stock_unit "pack" (pack products only). */
export function toItemQty(product, qty, stockUnit) {
  if (stockUnit !== "pack") return qty
  const packSize = Number(product?.pack_size)
  if (!product?.is_pack_product || !(packSize >= 2)) {
    throw new AppError(`${product?.title || "This product"} is not a pack product: send stock_unit unit`, 400)
  }
  return Number(qty) * packSize
}
