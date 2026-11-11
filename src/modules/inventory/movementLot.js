/**
 * The lot a stock movement moved, as one object { id (lot number), qty (signed), expiry_date } (null when it
 * moved no lot). A movement is written per lot, so there is one; an older movement that spanned several lots
 * shows its first one.
 */
export function movementLot(row) {
  let lots = row.lots
  if (typeof lots === "string") {
    try {
      lots = JSON.parse(lots || "[]")
    } catch {
      lots = []
    }
  }
  const first = Array.isArray(lots) ? lots[0] : null
  return first ? { id: first.lot_number, qty: Number(first.qty), expiry_date: first.expiry_date || null } : null
}
