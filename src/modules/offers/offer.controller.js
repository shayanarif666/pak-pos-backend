import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { getStoreForManager } from "../stores/store.service.js"
import { bulkStatus, posBulkResponse, extractBulkItems, runBulk } from "../../shared/utils/bulk.util.js"
import { parseCreateOffer, parsePatchOffer } from "./offer.validation.js"
import { Offer } from "./offer.model.js"
import { bulkUpdateResponse, requireBoolean, runBulkUpdate } from "../../shared/utils/bulkUpdate.util.js"
import * as offerService from "./offer.service.js"
import { actingAs, resolveStaff } from "../../shared/utils/staff.util.js"
import { posOffer, posOffers } from "../pos/posResponses.js"
import * as posHistory from "../pos/posHistory.service.js"

// The offer is added by the PIN-picked staff member (created_by); the location context stays
// the request's (token, or the store admin's location_id).
async function offerActor(req, staffRef) {
  const base = { ...req.user.get({ plain: true }), location_id: req.auth?.location_id || req.user.location_id }
  return actingAs(base, await resolveStaff(base.store_id, staffRef, req.user))
}

function offerSummary(result) {
  const { summary: _summary, ...view } = result
  return posOffer(view)
}

export const list = asyncHandler(async (req, res) => {
  if (req.auth?.channel === "pos") return posHistory.sendPage(res, await posHistory.offers(req))
  const data = await offerService.listOffers(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const getOne = asyncHandler(async (req, res) => {
  const data = await offerService.getOfferView(req.user, req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const create = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const { staff_ref, ...input } = req.body
  const result = await offerService.createOffer(store, input, await offerActor(req, staff_ref))
  const { summary: _summary, ...data } = result
  if (req.auth?.channel === "pos") {
    return apiResponse(res, 201, "Offer Created", await offerSummary(result))
  }
  return apiResponse(res, 201, "Offer created", data)
})

export const createBulk = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const fallbackStaff = req.body?.staff_id ?? req.body?.staffId ?? null
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    const { staff_ref, ...input } = parseCreateOffer(item)
    const ref = staff_ref || (fallbackStaff == null ? null : String(fallbackStaff))
    return offerService.createOffer(store, input, await offerActor(req, ref))
  })
  if (req.auth?.channel === "pos") {
    const created = []
    created.push(...(await posOffers(data.created.map(({ summary: _summary, ...view }) => view))))
    return posBulkResponse(res, data, "Offer Created", created)
  }
  const created = data.created.map(({ summary, ...row }) => row)
  return apiResponse(res, bulkStatus(data), "Bulk offers processed", { ...data, created })
})

export const patch = asyncHandler(async (req, res) => {
  const data = await offerService.updateOffer(req.user, req.params.id, req.body)
  return apiResponse(res, 200, "Offer updated", data)
})

export const remove = asyncHandler(async (req, res) => {
  const data = await offerService.deactivateOffer(req.user, req.params.id)
  return apiResponse(res, 200, "Offer deactivated", data)
})

export const listTargets = asyncHandler(async (req, res) => {
  const data = await offerService.listTargets(req.user, req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const putTargets = asyncHandler(async (req, res) => {
  const data = await offerService.replaceTargets(
    req.user,
    req.params.id,
    req.body
  )
  return apiResponse(res, 200, "Targets updated", data)
})

// ---- Bulk updates (POS offline sync): items[] = [{ id (offer number), ...fields }] ----

function bulkOfferUpdate(parse, message) {
  return asyncHandler(async (req, res) => {
    const data = await runBulkUpdate(req.body, {
      model: Offer,
      column: "offer_number",
      label: "Offer",
      storeId: req.storeId,
      handler: (uuid, fields) => offerService.updateOffer(req.user, uuid, parse(fields)),
    })
    const views = data.created.map(({ summary: _summary, ...view }) => view)
    const rows = req.auth?.channel === "pos" ? await posOffers(views) : views
    return bulkUpdateResponse(res, data, message, rows)
  })
}

/** PATCH /offers/bulk — name, type, discount, min / buy / get qty, dates, locations, is_active. */
export const patchBulk = bulkOfferUpdate(parsePatchOffer, "Offers Updated")

/** PATCH /offers/bulk/status — { id, is_active }: switch a sale on or off at once. */
export const patchBulkStatus = bulkOfferUpdate(
  (fields) => ({ is_active: requireBoolean(fields, "is_active") }),
  "Offer Status Updated"
)
