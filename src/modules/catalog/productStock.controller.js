import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as stockService from "./productStock.service.js"
import { parseDeleteStockEntry, parsePutStock, parseStockEditItem } from "./productStock.validation.js"
import { stockEditRows } from "../inventory/stockEditView.js"
import { Product } from "./product.model.js"
import { Refs } from "../pos/posResponses.js"
import { AppError } from "../../shared/errors/AppError.js"
import { extractBulkItems, runBulk } from "../../shared/utils/bulk.util.js"
import { bulkUpdateResponse, uuidOfNumber } from "../../shared/utils/bulkUpdate.util.js"
import { bulkLocation } from "../../shared/utils/location.util.js"
import { resolveStaff } from "../../shared/utils/staff.util.js"

export const list = asyncHandler(async (req, res) => {
  const data = await stockService.listStocks(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const listLow = asyncHandler(async (req, res) => {
  const data = await stockService.listLowStocks(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const getOne = asyncHandler(async (req, res) => {
  const data = await stockService.getStock(req.user, req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const put = asyncHandler(async (req, res) => {
  const actor = {
    ...req.user.get({ plain: true }),
    store_id: req.auth?.store_id || req.user.store_id,
    location_id: req.auth?.location_id || req.user.location_id,
    store_id_int: req.user.store_id_int,
  }
  const data = await stockService.putStock(
    actor,
    req.params.productId,
    req.body
  )
  return apiResponse(res, 200, "Stock updated", data)
})

// ---- Bulk stock updates (POS offline sync) ----
// { locationId, staff_id?, items: [{ product_id (product number), ... }] }; locationId and
// staff_id are sent once (each item may also carry its own staff_id).

const MOVE_TYPES = ["stock_in", "stock_out", "adjustment"]

function stockActor(req, location, staff) {
  return {
    ...req.user.get({ plain: true }),
    id: staff.id,
    store_id: req.auth?.store_id || req.user.store_id,
    location_id: location?.id || req.auth?.location_id || req.user.location_id,
    store_id_int: req.user.store_id_int,
  }
}

function moveType(value) {
  if (value === undefined || value === null || value === "") return undefined
  if (!MOVE_TYPES.includes(value)) throw new AppError(`movement_type must be one of: ${MOVE_TYPES.join(", ")}`, 400)
  return value
}

async function bulkStock(req, res, message, toFields) {
  const location = await bulkLocation(req)
  const fallbackStaff = req.body?.staff_id ?? req.body?.staffId ?? null
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    if (!item || typeof item !== "object") throw new AppError("Each item must be an object", 400)
    const productId = await uuidOfNumber(Product, "product_number", req.storeId, item.product_id ?? item.productId, "Product")
    const ref = item.staff_id ?? item.staffId ?? fallbackStaff
    const staff = await resolveStaff(req.storeId, ref == null ? null : String(ref), req.user)
    const input = toFields(item)
    const fields = { ...parsePutStock({ ...input, location_id: location?.id }), movement_type: input.movement_type }
    return stockService.putStock(stockActor(req, location, staff), productId, fields)
  })
  return bulkUpdateResponse(res, data, message, await shapeStocks(req, data.created))
}

async function shapeStocks(req, rows) {
  if (req.auth?.channel !== "pos") return rows
  const refs = await new Refs().loadAll({
    product: rows.map((row) => row.product_id),
    location: rows.map((row) => row.location_id),
  })
  return rows.map((row) => ({
    product: refs.product(row.product_id),
    location: refs.location(row.location_id),
    qty: row.qty,
    number_of_packs: row.number_of_packs,
    expiry_date: row.expiry_date,
    low_stock_threshold: row.low_stock_threshold,
    is_low: row.is_low,
  }))
}

/** The product (or its variant: variant_id = the variant number inside it) as a UUID. */
async function stockProductId(storeId, item) {
  const productId = await uuidOfNumber(Product, "product_number", storeId, item.product_id ?? item.productId, "Product")
  const variantRef = item.variant_id ?? item.variantId
  if (variantRef === undefined || variantRef === null || variantRef === "") return productId
  const value = String(variantRef).trim()
  const variant = await Product.findOne({
    where: /^\d+$/.test(value)
      ? { store_id: storeId, parent_product_id: productId, variant_number: Number(value) }
      : { store_id: storeId, parent_product_id: productId, id: value },
    attributes: ["id"],
  })
  if (!variant) throw new AppError(`Variant ${value} is not a variant of product ${item.product_id ?? item.productId}`, 404)
  return variant.id
}

/**
 * PATCH /product-stocks/bulk — { locationId?, staff_id?, items: [{ product_id, variant_id?,
 * location_id?, qty | delta | number_of_packs + loose_units, expiry_date?, low_stock_threshold?,
 * reason?, movement_type?, reason_note? }] }, one item or many (POS sync and the dashboard's
 * Product Stock & Expiry). location_id on an item wins over locationId sent once. Every qty change
 * writes a movement. data = [{ stock, movement }] with short numbers only (movement null when the
 * qty did not change).
 */
export const patchBulk = asyncHandler(async (req, res) => {
  const location = await bulkLocation(req)
  const fallbackStaff = req.body?.staff_id ?? req.body?.staffId ?? null
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new AppError("Each item must be an object", 400)
    const productId = await stockProductId(req.storeId, item)
    const ref = item.staff_id ?? item.staffId ?? fallbackStaff
    const staff = await resolveStaff(req.storeId, ref == null ? null : String(ref), req.user)
    const itemLocation = item.location_id ?? item.locationId
    const locationRef = itemLocation == null || itemLocation === "" ? location?.id : String(itemLocation)
    return stockService.editStock(stockActor(req, null, staff), productId, locationRef, parseStockEditItem(item))
  })
  return bulkUpdateResponse(res, data, "Stock Updated", await stockEditRows(data.created))
})

/**
 * PATCH /product-stocks/bulk/qty — one movement_type and reason for every item:
 * stock_in adds qty, stock_out takes qty away, adjustment sets the stock to qty.
 */
export const patchBulkQty = asyncHandler(async (req, res) => {
  const type = moveType(req.body?.movement_type)
  if (!type) throw new AppError("movement_type is required", 400)
  if (!req.body?.reason) throw new AppError("reason is required", 400)
  return bulkStock(req, res, "Stock Qty Updated", (item) => {
    const qty = Number(item.qty)
    if (Number.isNaN(qty) || qty < 0 || (type !== "adjustment" && qty === 0)) {
      throw new AppError("qty must be a number above 0", 400)
    }
    return {
      ...(type === "adjustment" ? { qty } : { delta: type === "stock_in" ? qty : -qty }),
      reason: req.body.reason,
      movement_type: type,
      reason_note: item.note ?? req.body.note ?? null,
    }
  })
})

// ---- One stock entry from Product Stock & Expiry (:id = the stock entry's UUID) ----

function entryActor(req) {
  return {
    ...req.user.get({ plain: true }),
    store_id: req.auth?.store_id || req.user.store_id,
    location_id: req.auth?.location_id || req.user.location_id,
    store_id_int: req.user.store_id_int,
  }
}

/** DELETE /product-stocks/:id — soft delete (qty set to 0 by an adjustment movement first). */
export const removeEntry = asyncHandler(async (req, res) => {
  const result = await stockService.deleteStockEntry(entryActor(req), req.params.id, parseDeleteStockEntry(req.body))
  const [data] = await stockEditRows([result])
  return apiResponse(res, 200, "Stock Deleted", data)
})
