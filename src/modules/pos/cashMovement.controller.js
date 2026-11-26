import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { extractBulkItems, posBulkResponse, runBulk } from "../../shared/utils/bulk.util.js"
import { bulkUpdateResponse, runBulkUpdate } from "../../shared/utils/bulkUpdate.util.js"
import { getStoreForManager } from "../stores/store.service.js"
import { CashMovement } from "./cashMovement.model.js"
import { parseCreateCashMovement, parsePatchCashMovement } from "./cashMovement.validation.js"
import * as cashService from "./cashMovement.service.js"
import * as posHistory from "./posHistory.service.js"

/** GET /cash-movements — a page of movements, with the summary of every matching one. */
export const list = asyncHandler(async (req, res) => {
  const result = await posHistory.cashMovements(req)
  return res.status(200).json({ success: true, message: "OK", data: result.rows, pagination: result.pagination, summary: result.summary })
})

export const getOne = asyncHandler(async (req, res) => {
  return apiResponse(res, 200, "Cash Movement", await posHistory.cashMovementOne(req))
})

/** POST /cash-movements — one movement (the body is the movement). */
export const create = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const { view, idempotent } = await cashService.createCashMovement(store, req.user, parseCreateCashMovement(req.body))
  return apiResponse(res, idempotent ? 200 : 201, idempotent ? "Cash Movement Already Saved" : "Cash Movement Created", view)
})

/** POST /cash-movements/bulk — { storeId, locationId?, staffId?, deviceId?, items: [...] }; each saved on its own. */
export const createBulk = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const topDevice = req.body?.deviceId ?? req.body?.device_id
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    const fields = parseCreateCashMovement({
      ...item,
      // The request's location (set by requestScope) and the device sent once on top.
      location_id: req.body.location_id || null,
      ...(topDevice !== undefined && item.deviceId === undefined && item.device_id === undefined ? { device_id: topDevice } : {}),
    })
    return (await cashService.createCashMovement(store, req.user, fields)).view
  })
  return posBulkResponse(res, data, "Cash Movements Created", data.created)
})

/** PATCH /cash-movements/bulk — items[] = [{ id (movement number), ...fields of the POST }]. */
export const patchBulk = asyncHandler(async (req, res) => {
  const data = await runBulkUpdate(req.body, {
    model: CashMovement,
    column: "movement_number",
    label: "Cash movement",
    storeId: req.storeId,
    handler: (uuid, fields) => cashService.updateCashMovement(req.user, uuid, parsePatchCashMovement(fields)),
  })
  return bulkUpdateResponse(res, data, "Cash Movements Updated", data.created)
})

export const patchOne = asyncHandler(async (req, res) => {
  return apiResponse(res, 200, "Cash Movement Updated", await cashService.updateCashMovement(req.user, req.params.id, parsePatchCashMovement(req.body)))
})

export const remove = asyncHandler(async (req, res) => {
  return apiResponse(res, 200, "Cash Movement Deleted", await cashService.deleteCashMovement(req.user, req.params.id))
})
