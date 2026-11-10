import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { getStoreForManager } from "../stores/store.service.js"
import { bulkStatus, posBulkResponse, extractBulkItems, runBulk } from "../../shared/utils/bulk.util.js"
import { bulkUpdateResponse, runBulkUpdate, uuidOfNumber } from "../../shared/utils/bulkUpdate.util.js"
import { actingAs, resolveStaff } from "../../shared/utils/staff.util.js"
import { BulkDiscount } from "./bulkDiscount.model.js"
import { parseCreateBulk, parsePatchBulk } from "./bulkDiscount.validation.js"
import * as service from "./bulkDiscount.service.js"
import { posBulks, sendList } from "./discountResponses.js"

const isPos = (req) => req.auth?.channel === "pos"
const posOne = async (view) => (await posBulks([view]))[0]

async function actorFor(req, staffRef) {
  const base = { ...req.user.get({ plain: true }), location_id: req.auth?.location_id || req.user.location_id }
  return actingAs(base, await resolveStaff(base.store_id, staffRef, req.user))
}

const idOf = (req) =>
  /^\d+$/.test(String(req.params.id))
    ? uuidOfNumber(BulkDiscount, "bulk_number", req.storeId, req.params.id, "Bulk discount")
    : req.params.id

export const list = asyncHandler(async (req, res) => {
  const data = await service.listBulks(req.storeId, req.query)
  if (isPos(req)) return sendList(req, res, await posBulks(data), (row) => row)
  return apiResponse(res, 200, "OK", data)
})

export const getOne = asyncHandler(async (req, res) => {
  const view = service.publicBulk(await service.getBulk(req.storeId, await idOf(req)))
  return apiResponse(res, 200, "OK", isPos(req) ? await posOne(view) : view)
})

export const create = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const input = parseCreateBulk(req.body)
  const view = await service.createBulk(store, input, await actorFor(req, input.staff_ref))
  return apiResponse(res, 201, "Bulk discount created", isPos(req) ? await posOne(view) : view)
})

export const createBulk = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const fallbackStaff = req.body?.staff_id ?? req.body?.staffId ?? null
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    const input = parseCreateBulk(item)
    const ref = input.staff_ref || (fallbackStaff == null ? null : String(fallbackStaff))
    return service.createBulk(store, input, await actorFor(req, ref))
  })
  if (isPos(req)) return posBulkResponse(res, data, "Bulk Discount Created", await posBulks(data.created))
  return apiResponse(res, bulkStatus(data), "Bulk discounts processed", data)
})

export const patch = asyncHandler(async (req, res) => {
  const view = await service.updateBulk(req.storeId, await idOf(req), parsePatchBulk(req.body))
  return apiResponse(res, 200, "Bulk discount updated", isPos(req) ? await posOne(view) : view)
})

export const remove = asyncHandler(async (req, res) => {
  const view = await service.deleteBulk(req.storeId, await idOf(req))
  return apiResponse(res, 200, "Bulk discount deleted", isPos(req) ? { ...(await posOne(view)), deleted_at: view.deleted_at } : view)
})

/** PATCH /bulk-discounts/bulk: items[] = [{ id (bulk discount number), ...fields }]. */
export const patchBulk = asyncHandler(async (req, res) => {
  const data = await runBulkUpdate(req.body, {
    model: BulkDiscount,
    column: "bulk_number",
    label: "Bulk discount",
    storeId: req.storeId,
    handler: (uuid, fields) => service.updateBulk(req.storeId, uuid, parsePatchBulk(fields)),
  })
  return bulkUpdateResponse(res, data, "Bulk Discounts Updated", isPos(req) ? await posBulks(data.created) : data.created)
})
