import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as transferService from "./transfer.service.js"
import { resolveStaff } from "../../shared/utils/staff.util.js"
import { posTransfer, posTransfers } from "../pos/posResponses.js"
import { bulkStatus, posBulkResponse, extractBulkItems, runBulk } from "../../shared/utils/bulk.util.js"
import { parseCreateTransfer } from "./transfer.validation.js"
import * as posHistory from "../pos/posHistory.service.js"

export const list = asyncHandler(async (req, res) => {
  if (req.auth?.channel === "pos") return posHistory.sendPage(res, await posHistory.stockTransfers(req))
  const data = await transferService.listTransfers(req.storeId)
  return apiResponse(res, 200, "OK", data)
})

export const create = asyncHandler(async (req, res) => {
  const { staff_ref, ...fields } = req.body
  // created_by = the staff member who sent it (PIN-picked), else the signed-in user.
  const staff = await resolveStaff(req.storeId, staff_ref == null ? null : String(staff_ref), req.user)
  const data = await transferService.createTransfer(req.storeId, fields, staff)
  if (req.auth?.channel === "pos") {
    return apiResponse(res, 201, "Stock Transfer Created", await posTransfer(data))
  }
  return apiResponse(res, 201, "Transfer created", data)
})

export const complete = asyncHandler(async (req, res) => {
  const data = await transferService.completeTransfer(
    req.storeId,
    req.params.id,
    req.user
  )
  return apiResponse(res, 200, "Transfer completed", data)
})

export const cancel = asyncHandler(async (req, res) => {
  const data = await transferService.cancelTransfer(req.storeId, req.params.id)
  return apiResponse(res, 200, "Transfer cancelled", data)
})

export const createBulk = asyncHandler(async (req, res) => {
  // staff_id may be sent once next to items[] or on each transfer.
  const fallbackStaff = req.body?.staff_id ?? req.body?.staffId ?? null
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    const { staff_ref, ...fields } = parseCreateTransfer(item)
    const ref = staff_ref ?? fallbackStaff
    const staff = await resolveStaff(req.storeId, ref == null ? null : String(ref), req.user)
    return transferService.createTransfer(req.storeId, fields, staff)
  })
  if (req.auth?.channel === "pos") {
    const created = []
    created.push(...(await posTransfers(data.created)))
    return posBulkResponse(res, data, "Stock Transfer Created", created)
  }
  return apiResponse(res, bulkStatus(data), "Bulk stock transfers processed", data)
})
