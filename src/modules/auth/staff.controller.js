import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { bulkStatus, posBulkResponse, extractBulkItems, runBulk } from "../../shared/utils/bulk.util.js"
import { parseCreateStaff, parsePatchStaff, parseStaffPasswordReset } from "./staff.validation.js"
import { User } from "./user.model.js"
import { Location } from "../locations/location.model.js"
import { AppError } from "../../shared/errors/AppError.js"
import {
  bulkUpdateResponse,
  optionalUuidOfNumber,
  pickFields,
  requireBoolean,
  runBulkUpdate,
} from "../../shared/utils/bulkUpdate.util.js"
import * as staffService from "./staff.service.js"
import * as posHistory from "../pos/posHistory.service.js"
import { Refs } from "../pos/posResponses.js"

export const list = asyncHandler(async (req, res) => {
  if (req.auth?.channel === "pos") return posHistory.sendPage(res, await posHistory.staff(req))
  const data = await staffService.listStaff(req.user, req.query)
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

// ---- Bulk updates (POS offline sync): items[] = [{ id (staff number), ...fields }] ----

function staffActor(req) {
  return {
    ...req.user.get({ plain: true }),
    store_id: req.auth?.store_id || req.user.store_id,
    location_id: req.auth?.location_id || req.user.location_id,
  }
}

function bulkStaffUpdate(parse, message, validateFields = parsePatchStaff) {
  return asyncHandler(async (req, res) => {
    const actor = staffActor(req)
    const data = await runBulkUpdate(req.body, {
      model: User,
      column: "user_number",
      label: "Staff",
      storeId: actor.store_id,
      handler: async (uuid, fields) => {
        const location = await optionalUuidOfNumber(Location, "location_id_int", actor.store_id, fields.location_id, "Location")
        const input = location === undefined ? fields : { ...fields, location_id: location }
        return staffService.patchStaff(actor, uuid, validateFields(parse(input)))
      },
    })
    const rows = req.auth?.channel === "pos" ? await staffWithLocations(data.created) : data.created
    return bulkUpdateResponse(res, data, message, rows)
  })
}

/** PATCH /staff/bulk — name, phone, role, location_id, is_active, password, pin. */
export const patchBulk = bulkStaffUpdate((fields) => fields, "Staff Updated")

/** PATCH /staff/bulk/status — { id, is_active }: false = left the job (cannot log in, history stays). */
export const patchBulkStatus = bulkStaffUpdate(
  (fields) => ({ is_active: requireBoolean(fields, "is_active") }),
  "Staff Status Updated"
)

/** PATCH /staff/bulk/location — { id, location_id (location number) }: moved to another branch. */
export const patchBulkLocation = bulkStaffUpdate((fields) => {
  if (fields.location_id === undefined || fields.location_id === null) {
    throw new AppError("location_id is required", 400)
  }
  return { location_id: fields.location_id }
}, "Staff Location Updated")

/** PATCH /staff/bulk/password — { id, password?, pin? }: a manager resets a forgotten password / PIN. */
export const patchBulkPassword = bulkStaffUpdate(
  (fields) => pickFields(fields, ["password", "pin"], "password"),
  "Staff Password Updated",
  parseStaffPasswordReset
)

/** DELETE /staff/:id — soft delete (the row and history stay). */
export const remove = asyncHandler(async (req, res) => {
  const data = await staffService.deleteStaff(req.user, req.params.id)
  return apiResponse(res, 200, "Staff deleted", data)
})
