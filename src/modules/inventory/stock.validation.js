import { AppError } from "../../shared/errors/AppError.js"
import { STOCK_MOVEMENT_REASON } from "../../db/enums.js"
import { parseCatalogVisibility } from "../../db/channelVisibility.js"
import { staffRefFrom } from "../../shared/utils/staff.util.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const MANUAL_TYPES = ["stock_in", "stock_out", "adjustment"]
// "sale" is allowed so the POS can post a sale-driven adjustment; refund/transfer/custom_sale
// movements are only written by their own flows.
const MANUAL_REASONS = STOCK_MOVEMENT_REASON.filter(
  (reason) => !["refund", "transfer", "custom_sale"].includes(reason)
)

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
    throw new AppError("Invalid stock movement reason", 400)
  }
  const qty = Number(body.qty)
  if (Number.isNaN(qty) || qty === 0) {
    throw new AppError("qty must be a non-zero number", 400)
  }
  if (movement_type === "stock_in" && qty < 0) {
    throw new AppError("stock_in qty must be positive", 400)
  }
  if (movement_type === "stock_out" && qty > 0) {
    throw new AppError("stock_out qty must be negative", 400)
  }

  // Optional: left out, the location's current expiry date stays as it is.
  let expiry_date
  if (body.expiry_date !== undefined && body.expiry_date !== null && body.expiry_date !== "") {
    expiry_date = new Date(body.expiry_date)
    if (Number.isNaN(expiry_date.getTime())) {
      throw new AppError("expiry_date is invalid", 400)
    }
  }

  return {
    product: requireProductRef(body),
    // The location (number or UUID); without it the token's location is used.
    location_id: optionalLocationRef(body),
    movement_type,
    reason,
    qty,
    reason_note:
      body.reason_note === undefined || body.reason_note === null
        ? null
        : String(body.reason_note).trim(),
    expiry_date,
    visibility: parseCatalogVisibility(body),
    // Who did it (PIN-picked staff) and, for a purchase, which supplier: numbers or UUIDs.
    staff_ref: staffRefFrom(body),
    supplier_ref: staffRefFrom(body, ["supplier_id", "supplierId"]),
  }
}
