import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { getStoreForManager } from "../stores/store.service.js"
import * as offerService from "./offer.service.js"

export const list = asyncHandler(async (req, res) => {
  const data = await offerService.listOffers(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const getOne = asyncHandler(async (req, res) => {
  const data = await offerService.getOfferView(req.user, req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const create = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const data = await offerService.createOffer(store, req.body, req.user)
  return apiResponse(res, 201, "Offer created", data)
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
