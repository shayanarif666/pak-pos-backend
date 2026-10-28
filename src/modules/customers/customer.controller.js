import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { getStoreForManager } from "../stores/store.service.js"
import { bulkStatus, extractBulkItems, runBulk } from "../../shared/utils/bulk.util.js"
import { parseCreateCustomer, parsePatchCustomer } from "./customer.validation.js"
import { Customer } from "./customer.model.js"
import { Location } from "../locations/location.model.js"
import { bulkUpdateResponse, optionalUuidOfNumber, runBulkUpdate } from "../../shared/utils/bulkUpdate.util.js"
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
  if (req.auth?.channel === "pos") {
    return apiResponse(res, 201, "Customer Successfully Created", null)
  }
  return apiResponse(res, 201, "Customer created", data)
})

export const createBulk = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    return customerService.createCustomer(store, parseCreateCustomer(item))
  })
  if (req.auth?.channel === "pos") {
    return apiResponse(res, bulkStatus(data), "Customers Successfully Created", null)
  }
  return apiResponse(res, bulkStatus(data), "Bulk customers processed", data)
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

/**
 * PATCH /customers/bulk (POS offline sync) — items[] = [{ id (customer number), ...fields }]:
 * name, email, phone, location_id, debt_notes, is_active.
 */
export const patchBulk = asyncHandler(async (req, res) => {
  const data = await runBulkUpdate(req.body, {
    model: Customer,
    column: "customer_number",
    label: "Customer",
    storeId: req.storeId,
    handler: async (uuid, fields) => {
      const location = await optionalUuidOfNumber(Location, "location_id_int", req.storeId, fields.location_id, "Location")
      const input = location === undefined ? fields : { ...fields, location_id: location }
      return customerService.updateCustomer(req.storeId, uuid, parsePatchCustomer(input))
    },
  })
  const rows = req.auth?.channel === "pos" ? data.created.map(posCustomer) : data.created
  return bulkUpdateResponse(res, data, "Customers Updated", rows)
})

/** POS shape of a customer: short numbers, no UUIDs. */
function posCustomer(view) {
  return {
    id: view.customer_number,
    name: view.name,
    phone: view.phone || null,
    email: view.email || null,
    location_id: view.location_number ?? null,
    total_debt: Number(view.total_debt || 0),
    remaining_debt: Number(view.remaining_debt || 0),
    debt_notes: view.debt_notes || null,
    is_active: Boolean(view.is_active),
  }
}
