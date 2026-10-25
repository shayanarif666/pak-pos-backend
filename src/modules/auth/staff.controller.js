import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { bulkStatus, posBulkResponse, extractBulkItems, runBulk } from "../../shared/utils/bulk.util.js"
import { parseCreateStaff } from "./staff.validation.js"
import * as staffService from "./staff.service.js"
import * as posHistory from "../pos/posHistory.service.js"
import { Refs } from "../pos/posResponses.js"

export const list = asyncHandler(async (req, res) => {
  if (req.auth?.channel === "pos") return posHistory.sendPage(res, await posHistory.staff(req))
  const data = await staffService.listStaff(req.user)
  return apiResponse(res, 200, "OK", data)
})

export const getOne = asyncHandler(async (req, res) => {
  const data = await staffService.getStaff(req.user, req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const create = asyncHandler(async (req, res) => {
  const actor = {
    ...req.user.get({ plain: true }),
    store_id: req.auth?.store_id || req.user.store_id,
    location_id: req.auth?.location_id || req.user.location_id,
  }
  const data = await staffService.createStaff(actor, req.body)
  if (req.auth?.channel === "pos") {
    return apiResponse(res, 201, createdMessage([data]), posStaff(data, await new Refs().load("location", [data.location_id])))
  }
  return apiResponse(res, 201, "Staff created", data)
})

/** POS create response: { id (user_number), name, role }. */
// Same shape as the login users[] and GET /staff rows.
function posStaff(user, refs) {
  return {
    id: user.user_number,
    location: refs?.location(user.location_id) || null,
    name: user.name,
    email: user.email,
    pin: user.pin || null,
    role: user.role,
    phone: user.phone || null,
    is_active: Boolean(user.is_active),
  }
}

async function staffWithLocations(users) {
  const refs = await new Refs().load("location", users.map((user) => user.location_id))
  return users.map((user) => posStaff(user, refs))
}

// "Cashier Successfully Created" / "Managers Successfully Created"; mixed roles say "Staff".
function createdMessage(users) {
  const roles = new Set(users.map((user) => user.role))
  if (roles.size !== 1) return "Staff Successfully Created"
  const label = roles.has("manager") ? "Manager" : "Cashier"
  return `${label}${users.length > 1 ? "s" : ""} Successfully Created`
}

export const createBulk = asyncHandler(async (req, res) => {
  const actor = {
    ...req.user.get({ plain: true }),
    store_id: req.auth?.store_id || req.user.store_id,
    location_id: req.auth?.location_id || req.user.location_id,
  }
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    return staffService.createStaff(actor, parseCreateStaff(item))
  })
  if (req.auth?.channel === "pos") {
    return posBulkResponse(
      res,
      data,
      createdMessage(data.created),
      await staffWithLocations(data.created)
    )
  }
  return apiResponse(res, bulkStatus(data), "Bulk staff processed", data)
})

export const patch = asyncHandler(async (req, res) => {
  const data = await staffService.patchStaff(req.user, req.params.id, req.body)
  return apiResponse(res, 200, "Staff updated", data)
})

export const sales = asyncHandler(async (req, res) => {
  const data = await staffService.getStaffSales(req.user, req.params.id, req.query)
  return apiResponse(res, 200, "OK", data)
})
