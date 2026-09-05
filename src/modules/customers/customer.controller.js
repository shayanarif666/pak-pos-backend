import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { getStoreForManager } from "../stores/store.service.js"
import * as customerService from "./customer.service.js"

export const list = asyncHandler(async (req, res) => {
  const data = await customerService.listCustomers(req.storeId, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const getOne = asyncHandler(async (req, res) => {
  const data = await customerService.getCustomerView(req.storeId, req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const create = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const data = await customerService.createCustomer(store, req.body)
  return apiResponse(res, 201, "Customer created", data)
})

export const patch = asyncHandler(async (req, res) => {
  const data = await customerService.updateCustomer(
    req.storeId,
    req.params.id,
    req.body
  )
  return apiResponse(res, 200, "Customer updated", data)
})

export const listCredit = asyncHandler(async (req, res) => {
  const data = await customerService.listCredit(req.storeId, req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const addCredit = asyncHandler(async (req, res) => {
  const data = await customerService.addCreditEntry(
    req.storeId,
    req.params.id,
    req.body,
    req.user
  )
  return apiResponse(res, 201, "Credit entry recorded", data)
})
