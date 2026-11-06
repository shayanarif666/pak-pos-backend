import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as storeService from "../stores/store.service.js"
import * as locationService from "./location.service.js"
import { posView } from "../pos/posHistory.service.js"
import { Location } from "./location.model.js"
import { parsePatchLocation } from "./location.validation.js"
import { bulkUpdateResponse, runBulkUpdate, uuidOfNumber } from "../../shared/utils/bulkUpdate.util.js"

export const listLocations = asyncHandler(async (req, res) => {
  const actor = {
    role: req.user.role,
    location_id: req.auth?.location_id || req.user.location_id,
  }
  const rows = await locationService.listLocations(req.storeId, actor)
  if (req.auth?.channel === "pos") {
    return apiResponse(res, 200, "OK", rows.map((row) => posView(row, "location_number")))
  }
  return apiResponse(res, 200, "OK", rows)
})

export const getLocation = asyncHandler(async (req, res) => {
  const actor = {
    role: req.user.role,
    location_id: req.auth?.location_id || req.user.location_id,
  }
  const location = await locationService.getPublicLocation(
    req.storeId,
    req.params.id,
    actor
  )
  return apiResponse(res, 200, "OK", location)
})

export const createLocation = asyncHandler(async (req, res) => {
  const store = await storeService.getStoreForManager(req.storeId)
  const location = await locationService.createLocation(store, req.body)
  if (req.auth?.channel === "pos") {
    return apiResponse(res, 201, "Location Successfully Created", posView(location, "location_number"))
  }
  return apiResponse(res, 201, "Location created", location)
})

export const patchLocation = asyncHandler(async (req, res) => {
  const location = await locationService.updateLocation(
    req.storeId,
    req.params.id,
    req.body,
    req.user
  )
  return apiResponse(res, 200, "Location updated", location)
})

/**
 * PATCH /locations/bulk — items[] = [{ id (location number), ...fields }]: name, address_line,
 * city, postal_code, phone, is_active, is_default, manager_* (a manager only their own branch).
 */
export const patchBulk = asyncHandler(async (req, res) => {
  const data = await runBulkUpdate(req.body, {
    model: Location,
    column: "location_id_int",
    label: "Location",
    storeId: req.storeId,
    handler: (uuid, fields) => locationService.updateLocation(req.storeId, uuid, parsePatchLocation(fields), req.user),
  })
  const rows = req.auth?.channel === "pos" ? data.created.map(posLocation) : data.created
  return bulkUpdateResponse(res, data, "Locations Updated", rows)
})

/** POS shape of a location: its number as id, no UUIDs (the manager by name / email). */
function posLocation(view) {
  const { id: _uuid, store_id: _store, store_number: _storeNumber, location_number, created_at: _created, updated_at: _updated, manager, ...rest } = view
  const { id: _managerUuid, ...managerView } = manager || {}
  return { id: location_number, ...rest, manager: manager ? managerView : null }
}

/** DELETE /locations/:id (UUID or location number) — soft delete of a branch (store admin). */
export const deleteLocation = asyncHandler(async (req, res) => {
  const id = /^\d+$/.test(String(req.params.id))
    ? await uuidOfNumber(Location, "location_id_int", req.storeId, req.params.id, "Location")
    : req.params.id
  const location = await locationService.deleteLocation(req.storeId, id)
  if (req.auth?.channel === "pos") {
    return apiResponse(res, 200, "Location Deleted", posView(location, "location_number"))
  }
  return apiResponse(res, 200, "Location deleted", location)
})
