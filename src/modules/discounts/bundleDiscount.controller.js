import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { getStoreForManager } from "../stores/store.service.js"
import { bulkStatus, posBulkResponse, extractBulkItems, runBulk } from "../../shared/utils/bulk.util.js"
import { bulkUpdateResponse, runBulkUpdate, uuidOfNumber } from "../../shared/utils/bulkUpdate.util.js"
import { actingAs, resolveStaff } from "../../shared/utils/staff.util.js"
import { BundleDiscount } from "./bundleDiscount.model.js"
import { parseCreateBundle, parsePatchBundle } from "./bundleDiscount.validation.js"
import * as service from "./bundleDiscount.service.js"
import { posBundles, sendList } from "./discountResponses.js"

const isPos = (req) => req.auth?.channel === "pos"
const posOne = async (view) => (await posBundles([view]))[0]

async function actorFor(req, staffRef) {
  const base = { ...req.user.get({ plain: true }), location_id: req.auth?.location_id || req.user.location_id }
  return actingAs(base, await resolveStaff(base.store_id, staffRef, req.user))
}

const idOf = (req) =>
  /^\d+$/.test(String(req.params.id))
    ? uuidOfNumber(BundleDiscount, "bundle_number", req.storeId, req.params.id, "Bundle discount")
    : req.params.id

export const list = asyncHandler(async (req, res) => {
  const data = await service.listBundles(req.storeId, req.query)
  if (isPos(req)) return sendList(req, res, await posBundles(data), (row) => row)
  return apiResponse(res, 200, "OK", data)
})

export const getOne = asyncHandler(async (req, res) => {
  const view = service.publicBundle(await service.getBundle(req.storeId, await idOf(req)))
  return apiResponse(res, 200, "OK", isPos(req) ? await posOne(view) : view)
})

export const create = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const input = parseCreateBundle(req.body)
  const view = await service.createBundle(store, input, await actorFor(req, input.staff_ref))
  return apiResponse(res, 201, "Bundle discount created", isPos(req) ? await posOne(view) : view)
})

export const createBulk = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const fallbackStaff = req.body?.staff_id ?? req.body?.staffId ?? null
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    const input = parseCreateBundle(item)
    const ref = input.staff_ref || (fallbackStaff == null ? null : String(fallbackStaff))
    return service.createBundle(store, input, await actorFor(req, ref))
  })
  if (isPos(req)) return posBulkResponse(res, data, "Bundle Discount Created", await posBundles(data.created))
  return apiResponse(res, bulkStatus(data), "Bulk bundle discounts processed", data)
})

export const patch = asyncHandler(async (req, res) => {
  const view = await service.updateBundle(req.storeId, await idOf(req), parsePatchBundle(req.body))
  return apiResponse(res, 200, "Bundle discount updated", isPos(req) ? await posOne(view) : view)
})

export const remove = asyncHandler(async (req, res) => {
  const view = await service.deleteBundle(req.storeId, await idOf(req))
  return apiResponse(res, 200, "Bundle discount deleted", isPos(req) ? { ...(await posOne(view)), deleted_at: view.deleted_at } : view)
})

/** PATCH /bundle-discounts/bulk: items[] = [{ id (bundle number), ...fields }] (POS offline sync). */
export const patchBulk = asyncHandler(async (req, res) => {
  const data = await runBulkUpdate(req.body, {
    model: BundleDiscount,
    column: "bundle_number",
    label: "Bundle discount",
    storeId: req.storeId,
    handler: (uuid, fields) => service.updateBundle(req.storeId, uuid, parsePatchBundle(fields)),
  })
  return bulkUpdateResponse(res, data, "Bundle Discounts Updated", isPos(req) ? await posBundles(data.created) : data.created)
})
