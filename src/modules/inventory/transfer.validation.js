import { AppError } from "../../shared/errors/AppError.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// A location / product reference: its short number (e.g. 1) or its UUID.
function requireRef(body, key, label = key) {
  const value = String(body?.[key] ?? "").trim()
  if (!(/^[1-9][0-9]*$/.test(value) || UUID_RE.test(value))) {
    throw new AppError(label + " must be a number or a UUID", 400)
  }
  return value
}

function requireQty(value, label) {
  const qty = Number(value)
  if (Number.isNaN(qty) || qty <= 0) throw new AppError(`${label} must be a number > 0`, 400)
  return qty
}

const refOf = (row, keys) => keys.map((key) => row?.[key]).find((value) => value != null && value !== "")

/** A product with variants: variant_id = the variant's number inside it (1, 2, 3…) or its UUID. */
function optionalVariant(row, label) {
  const value = refOf(row, ["variant_id", "variantId"])
  return value == null ? null : requireRef({ v: value }, "v", `${label}.variant_id`)
}

/** destinations: [{ to_location_id, products: [{ product_id, variant_id?, qty }] }], or the older single form. */
function parseDestinationList(body) {
  if (Array.isArray(body.destinations)) {
    if (!body.destinations.length) throw new AppError("destinations needs at least one location", 400)
    return body.destinations.map((dest, d) => {
      const label = `destinations[${d}]`
      if (!dest || typeof dest !== "object") throw new AppError(`${label} is invalid`, 400)
      const to_location_id = requireRef({ to: refOf(dest, ["to_location_id", "toLocationId"]) }, "to", `${label}.to_location_id`)
      if (!Array.isArray(dest.products) || !dest.products.length) {
        throw new AppError(`${label}.products needs at least one product`, 400)
      }
      const products = dest.products.map((row, p) => ({
        product_id: requireRef({ id: refOf(row, ["product_id", "productId"]) }, "id", `${label}.products[${p}].product_id`),
        variant_id: optionalVariant(row, `${label}.products[${p}]`),
        qty: requireQty(row?.qty, `${label}.products[${p}].qty`),
      }))
      return { to_location_id, products }
    })
  }
  return [
    {
      to_location_id: requireRef({ to: refOf(body, ["to_location_id", "toLocationId"]) }, "to", "to_location_id"),
      products: [
        {
          product_id: requireRef({ id: refOf(body, ["product_id", "productId"]) }, "id", "product_id"),
          variant_id: optionalVariant(body, "body"),
          qty: requireQty(body.qty, "qty"),
        },
      ],
    },
  ]
}

/** One destination named twice is merged; a product twice for one destination adds up. */
function mergeDestinations(destinations, from_location_id) {
  const byDestination = new Map()
  for (const dest of destinations) {
    if (from_location_id && dest.to_location_id === from_location_id) {
      throw new AppError("A destination cannot be the location the stock leaves from", 400)
    }
    const products = byDestination.get(dest.to_location_id) || new Map()
    for (const row of dest.products) {
      // One line per product / variant.
      const key = `${row.product_id}|${row.variant_id || ""}`
      const line = products.get(key) || { product_id: row.product_id, variant_id: row.variant_id, qty: 0 }
      line.qty += row.qty
      products.set(key, line)
    }
    byDestination.set(dest.to_location_id, products)
  }
  return [...byDestination].map(([to_location_id, products]) => ({ to_location_id, products: [...products.values()] }))
}

const noteOf = (body) => (body.note === undefined || body.note === null ? null : String(body.note).trim())

/**
 * One transfer: from one location to one or more destinations, each with its own products and qty:
 *   { from_location_id, note?, destinations: [{ to_location_id, products: [{ product_id, variant_id?, qty }] }] }
 * The older single form { from_location_id, to_location_id, product_id, qty } is one destination
 * with one product. The same product twice for one destination is one line (qty added up).
 */
export function parseCreateTransfer(body) {
  const from_location_id = requireRef({ from: refOf(body, ["from_location_id", "fromLocationId"]) }, "from", "from_location_id")
  return {
    // The staff member who sent it (PIN-picked); defaults to the signed-in user.
    staff_ref: body.staff_id ?? body.staffId ?? null,
    from_location_id,
    destinations: mergeDestinations(parseDestinationList(body), from_location_id),
    note: noteOf(body),
  }
}

/**
 * One item of PATCH /stock-transfers/bulk, the same shape as create plus id (read by the
 * controller): { from_location_id?, note?, destinations?: [...] }. destinations replace everything
 * on the way (the whole list, as on create); left out = the products stay. At least one field.
 */
export function parsePatchTransfer(body) {
  const fromRef = refOf(body, ["from_location_id", "fromLocationId"])
  const from_location_id = fromRef == null ? null : requireRef({ from: fromRef }, "from", "from_location_id")
  const hasDestinations = Array.isArray(body.destinations) || refOf(body, ["to_location_id", "toLocationId"]) != null
  const destinations = hasDestinations ? mergeDestinations(parseDestinationList(body), from_location_id) : undefined
  const note = body.note === undefined ? undefined : noteOf(body)
  if (!from_location_id && !destinations && note === undefined) {
    throw new AppError("Send destinations, from_location_id or note", 400)
  }
  return { staff_ref: body.staff_id ?? body.staffId ?? null, from_location_id, destinations, note }
}

/**
 * Receiving at a destination: { to_location_id?, products?: [{ product_id, received_qty, loss_reason_note? }],
 * received_qty?, loss_reason_note?, note? }. No products = everything still on the way there arrived in
 * full; received_qty (and loss_reason_note) alone are for a transfer with one product. loss_reason_note says
 * why less arrived than was sent.
 */
const lossNoteOf = (value) => (value === undefined || value === null ? undefined : String(value).trim())

export function parseReceive(fields = {}) {
  const toRef = refOf(fields, ["to_location_id", "toLocationId", "location_id", "locationId"])
  const products = Array.isArray(fields.products)
    ? fields.products.map((row, p) => {
        const received = Number(row?.received_qty ?? row?.qty)
        if (Number.isNaN(received) || received < 0) {
          throw new AppError(`products[${p}].received_qty must be a number >= 0`, 400)
        }
        return {
          product_id: requireRef({ id: refOf(row, ["product_id", "productId"]) }, "id", `products[${p}].product_id`),
          variant_id: optionalVariant(row, `products[${p}]`),
          received_qty: received,
          loss_reason_note: lossNoteOf(row?.loss_reason_note),
        }
      })
    : null
  return {
    to_location_id: toRef == null ? null : String(toRef).trim(),
    products,
    received_qty: fields.received_qty === undefined || fields.received_qty === null ? undefined : Number(fields.received_qty),
    loss_reason_note: lossNoteOf(fields.loss_reason_note),
    note: fields.note === undefined || fields.note === null ? null : String(fields.note).trim(),
  }
}
