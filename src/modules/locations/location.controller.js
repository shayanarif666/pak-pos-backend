import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as storeService from "../stores/store.service.js"
import * as locationService from "./location.service.js"

export const listLocations = asyncHandler(async (req, res) => {
  const rows = await locationService.listLocations(req.storeId)
  return apiResponse(res, 200, "OK", rows)
})

export const getLocation = asyncHandler(async (req, res) => {
  const location = await locationService.getLocation(req.storeId, req.params.id)
  return apiResponse(res, 200, "OK", locationService.publicLocation(location))
})

export const createLocation = asyncHandler(async (req, res) => {
  const store = await storeService.getStoreForManager(req.storeId)
  const location = await locationService.createLocation(store, req.body)
  return apiResponse(res, 201, "Location created", locationService.publicLocation(location))
})

export const patchLocation = asyncHandler(async (req, res) => {
  const location = await locationService.updateLocation(
    req.storeId,
    req.params.id,
    req.body,
    req.user
  )
  return apiResponse(res, 200, "Location updated", locationService.publicLocation(location))
})
