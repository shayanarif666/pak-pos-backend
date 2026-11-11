import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as storeService from "../stores/store.service.js"
import * as locationService from "./location.service.js"
import { pageOf, posView } from "../pos/posHistory.service.js"
import { Location } from "./location.model.js"
import { parsePatchLocation } from "./location.validation.js"
import { bulkUpdateResponse, runBulkUpdate, uuidOfNumber } from "../../shared/utils/bulkUpdate.util.js"

/** A branch as the POS reads it; users (managers and cashiers, the PIN only for a store admin) when the role may see them. */
function posLocationRow(location, users, { pin }) {
  return {
    id: location.location_id_int,
    name: location.name,
    address: location.address_line,
    city: location.city,
    country: countryName(location.country),
    postal_code: location.postal_code || null,
    phone: location.phone || null,
    is_default: Boolean(location.is_default),
    is_active: Boolean(location.is_active),
    ...(users
      ? {
          users: users.map((user) => ({
            name: user.name,
            email: user.email,
            phone: user.phone || null,
            role: user.role,
            ...(pin ? { pin: user.pin || null } : {}),
            is_active: Boolean(user.is_active),
          })),
        }
      : {}),
    created_at: location.created_at,
    updated_at: location.updated_at,
  }
}

/** PK → Pakistan; a name already spelled out stays. */
function countryName(code) {
  if (!code) return null
  try {
    return /^[A-Za-z]{2}$/.test(code) ? new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) || code : code
  } catch {
    return code
  }
}

export const listLocations = asyncHandler(async (req, res) => {
  const actor = {
    role: req.user.role,
    location_id: req.auth?.location_id || req.user.location_id,
  }
  if (req.auth?.channel === "pos") {
    const { page, limit, offset } = pageOf(req.query)
    const { rows, total } = await locationService.listLocationsPage(req.storeId, actor, { limit, offset })
    return res.status(200).json({
      success: true,
      message: "OK",
      data: rows.map(({ location, users }) => posLocationRow(location, users, { pin: actor.role === "store_admin" })),
      pagination: { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) },
    })
  }
  const rows = await locationService.listLocations(req.storeId, actor)
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
