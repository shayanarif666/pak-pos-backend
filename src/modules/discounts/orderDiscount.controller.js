import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { getStoreForManager } from "../stores/store.service.js"
import { bulkStatus, posBulkResponse, extractBulkItems, runBulk } from "../../shared/utils/bulk.util.js"
import { bulkUpdateResponse, runBulkUpdate, uuidOfNumber } from "../../shared/utils/bulkUpdate.util.js"
import { actingAs, resolveStaff } from "../../shared/utils/staff.util.js"
import { OrderDiscount } from "./orderDiscount.model.js"
import { parseCreateOrderDiscount, parsePatchOrderDiscount } from "./orderDiscount.validation.js"
import * as service from "./orderDiscount.service.js"
import { posOrderDiscount, sendList } from "./discountResponses.js"

const isPos = (req) => req.auth?.channel === "pos"

async function actorFor(req, staffRef) {
  const base = { ...req.user.get({ plain: true }), location_id: req.auth?.location_id || req.user.location_id }
  return actingAs(base, await resolveStaff(base.store_id, staffRef, req.user))
}

const idOf = (req) =>
  /^\d+$/.test(String(req.params.id))
    ? uuidOfNumber(OrderDiscount, "discount_number", req.storeId, req.params.id, "Discount")
    : req.params.id

export const list = asyncHandler(async (req, res) => {
  const data = await service.listOrderDiscounts(req.storeId, req.query)
  if (isPos(req)) return sendList(req, res, data, posOrderDiscount)
  return apiResponse(res, 200, "OK", data)
})

export const getOne = asyncHandler(async (req, res) => {
  const row = await service.getOrderDiscount(req.storeId, await idOf(req))
  const view = service.publicOrderDiscount(row)
  return apiResponse(res, 200, "OK", isPos(req) ? posOrderDiscount(view) : view)
})

export const create = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const input = parseCreateOrderDiscount(req.body)
  const view = await service.createOrderDiscount(store, input, await actorFor(req, input.staff_ref))
  return apiResponse(res, 201, "Discount created", isPos(req) ? posOrderDiscount(view) : view)
})

export const createBulk = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const fallbackStaff = req.body?.staff_id ?? req.body?.staffId ?? null
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    const input = parseCreateOrderDiscount(item)
    const ref = input.staff_ref || (fallbackStaff == null ? null : String(fallbackStaff))
    return service.createOrderDiscount(store, input, await actorFor(req, ref))
  })
  if (isPos(req)) return posBulkResponse(res, data, "Discount Created", data.created.map(posOrderDiscount))
  return apiResponse(res, bulkStatus(data), "Bulk discounts processed", data)
})

export const patch = asyncHandler(async (req, res) => {
  const view = await service.updateOrderDiscount(req.storeId, await idOf(req), parsePatchOrderDiscount(req.body))
  return apiResponse(res, 200, "Discount updated", isPos(req) ? posOrderDiscount(view) : view)
})

export const remove = asyncHandler(async (req, res) => {
  const view = await service.deleteOrderDiscount(req.storeId, await idOf(req))
  return apiResponse(res, 200, "Discount deleted", isPos(req) ? { ...posOrderDiscount(view), deleted_at: view.deleted_at } : view)
})

/** PATCH /discounts/bulk — items[] = [{ id (discount number), ...fields }] (POS offline sync). */
export const patchBulk = asyncHandler(async (req, res) => {
  const data = await runBulkUpdate(req.body, {
    model: OrderDiscount,
    column: "discount_number",
    label: "Discount",
    storeId: req.storeId,
    handler: (uuid, fields) => service.updateOrderDiscount(req.storeId, uuid, parsePatchOrderDiscount(fields)),
  })
  return bulkUpdateResponse(res, data, "Discounts Updated", isPos(req) ? data.created.map(posOrderDiscount) : data.created)
})
