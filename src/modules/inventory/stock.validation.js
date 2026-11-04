import { AppError } from "../../shared/errors/AppError.js"
import { STOCK_MOVEMENT_REASON } from "../../db/enums.js"
import { parseCatalogVisibility } from "../../db/channelVisibility.js"
import { staffRefFrom } from "../../shared/utils/staff.util.js"
import { parseStockUnit } from "../../shared/utils/stockUnit.util.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const MANUAL_TYPES = ["stock_in", "stock_out", "adjustment"]
// "sale" is allowed so the POS can post a sale-driven adjustment; refund/transfer/custom_sale
// movements are only written by their own flows.
// opening_balance is written by product create only.
const MANUAL_REASONS = STOCK_MOVEMENT_REASON.filter(
  (reason) => !["refund", "transfer", "custom_sale", "opening_balance"].includes(reason)
)

const REF_RE = /^([1-9][0-9]*|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i

function parseExpiry(value, label) {
  if (value === undefined || value === null || value === "") return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new AppError(`${label} is invalid`, 400)
  return date
}

/**
 * The qty of one movement. stock_in adds and stock_out takes away whatever the sign sent
 * (qty 5 or -5 both take 5 away on a stock_out); an adjustment keeps its sign.
 */
function signedQty(movement_type, value, label) {
  const qty = Number(value)
  if (value === undefined || value === null || value === "" || Number.isNaN(qty) || qty === 0) {
    throw new AppError(`${label} must be a non-zero number`, 400)
  }
  if (movement_type === "stock_in") return Math.abs(qty)
  if (movement_type === "stock_out") return -Math.abs(qty)
  return qty
}

/** stock: [{ location_id, qty, stock_unit?, expiry_date? }] → one unit per location (stock_unit unit | pack). */
function stockUnits(list, movement_type, label, variant = null) {
  if (!Array.isArray(list) || !list.length) throw new AppError(`${label} must be a non-empty array of { location_id, qty }`, 400)
  return list.map((entry, index) => {
    const at = `${label}[${index}]`
    if (!entry || typeof entry !== "object") throw new AppError(`${at} is invalid`, 400)
    const location = entry.location_id ?? entry.locationId
    if (location != null && location !== "" && !REF_RE.test(String(location).trim())) {
      throw new AppError(`${at}.location_id must be a location number or UUID`, 400)
    }
    return {
      variant,
      location: location == null || location === "" ? null : String(location).trim(),
      qty: signedQty(movement_type, entry.qty, `${at}.qty`),
      stock_unit: parseStockUnit(entry.stock_unit, `${at}.stock_unit`),
      expiry_date: parseExpiry(entry.expiry_date, `${at}.expiry_date`),
    }
  })
}

/** product_id: the product's short product_number (e.g. 1) or its UUID. product_number is the old key. */
function requireProductRef(body) {
  const raw = body.product_id ?? body.product_number
  const value = raw === undefined || raw === null ? "" : String(raw).trim()
  if (/^\d+$/.test(value) && Number(value) > 0) return { product_number: Number(value) }
  if (UUID_RE.test(value)) return { product_id: value }
  throw new AppError("product_id must be the product number or its UUID", 400)
}


// A location reference: its number (e.g. 1) or UUID; location_id or locationId.
function optionalLocationRef(body) {
  const key = body.location_id != null && body.location_id !== "" ? "location_id" : "locationId"
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  const value = String(body[key]).trim()
  if (!(/^[1-9][0-9]*$/.test(value) || UUID_RE.test(value))) {
    throw new AppError(key + " must be a location number or UUID", 400)
  }
  return value
}

export function parseCreateMovement(body) {
  const movement_type = String(body.movement_type || "")
  if (!MANUAL_TYPES.includes(movement_type)) {
    throw new AppError(
      "movement_type must be stock_in, stock_out, or adjustment",
      400
    )
  }
  const reason = String(body.reason || "")
  if (!MANUAL_REASONS.includes(reason)) {
    throw new AppError(
      reason === "opening_balance"
        ? "opening_balance is written when the product is created; use purchase for new stock"
        : "Invalid stock movement reason",
      400
    )
  }
  // What moves: variants [{ id (variant number), stock: [{ location_id, qty }] }], or stock [...]
  // for a product without variants, or (older clients) one qty at location_id / the token's.
  let units
  if (Array.isArray(body.variants)) {
    if (!body.variants.length) throw new AppError("variants must not be empty", 400)
    units = body.variants.flatMap((row, index) => {
      const ref = row?.id ?? row?.variant_id ?? row?.variantId
      if (ref == null || !REF_RE.test(String(ref).trim())) {
        throw new AppError(`variants[${index}].id must be the variant number (1, 2, 3…) or its UUID`, 400)
      }
      return stockUnits(row.stock, movement_type, `variants[${index}].stock`, String(ref).trim())
    })
  } else if (Array.isArray(body.stock)) {
    units = stockUnits(body.stock, movement_type, "stock")
  } else {
    units = [{
      variant: null,
      location: null,
      qty: signedQty(movement_type, body.qty, "qty"),
      stock_unit: parseStockUnit(body.stock_unit, "stock_unit"),
      expiry_date: parseExpiry(body.expiry_date, "expiry_date"),
    }]
  }

  return {
    product: requireProductRef(body),
    units,
    // The location (number or UUID) of a row that names none; else the token's location.
    location_id: optionalLocationRef(body),
    movement_type,
    reason,
    reason_note:
      body.reason_note === undefined || body.reason_note === null
        ? null
        : String(body.reason_note).trim(),
    visibility: parseCatalogVisibility(body),
    // Who did it (PIN-picked staff) and, for a purchase, which supplier: numbers or UUIDs.
    staff_ref: staffRefFrom(body),
    supplier_ref: staffRefFrom(body, ["supplier_id", "supplierId"]),
  }
}
