import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as transferService from "./transfer.service.js"
import { resolveStaff } from "../../shared/utils/staff.util.js"
import { posTransfer, posTransfers } from "../pos/posResponses.js"
import { bulkStatus, posBulkResponse, extractBulkItems, runBulk } from "../../shared/utils/bulk.util.js"
import { parseCreateTransfer, parseReceive } from "./transfer.validation.js"
import * as posHistory from "../pos/posHistory.service.js"
import { StockTransfer } from "./stockTransfer.model.js"
import { AppError } from "../../shared/errors/AppError.js"
import { bulkUpdateResponse, runBulkUpdate } from "../../shared/utils/bulkUpdate.util.js"

// The acting user with the request's location (a manager / cashier: their own).
const actorOf = (req, staff = req.user) => ({
  id: staff.id,
  role: req.user.role,
  location_id: req.auth?.location_id || req.user.location_id || null,
})

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

/** Everything still on the way arrives in full (a manager: what comes to their location). */
export const complete = asyncHandler(async (req, res) => {
  const data = await transferService.receiveTransfer(req.storeId, req.params.id, actorOf(req), parseReceive(req.body || {}))
  return apiResponse(res, 200, "Transfer completed", data)
})

export const cancel = asyncHandler(async (req, res) => {
  const { to_location_id, products } = parseReceive(req.body || {})
  const data = await transferService.cancelTransfer(req.storeId, req.params.id, { to_location_id, products }, actorOf(req))
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
    return posBulkResponse(res, data, "Stock Transfer Created", await posTransfers(data.created))
  }
  return apiResponse(res, bulkStatus(data), "Bulk stock transfers processed", data)
})

// ---- Bulk updates (POS offline sync): items[] = [{ id (transfer number), ...fields }] ----

function bulkTransferUpdate(message, handler) {
  return asyncHandler(async (req, res) => {
    const fallbackStaff = req.body?.staff_id ?? req.body?.staffId ?? null
    const data = await runBulkUpdate(req.body, {
      model: StockTransfer,
      column: "transfer_number",
      label: "Transfer",
      storeId: req.storeId,
      handler: async (uuid, fields) => {
        const ref = fields.staff_id ?? fields.staffId ?? fallbackStaff
        const staff = await resolveStaff(req.storeId, ref == null ? null : String(ref), req.user)
        return handler(req, uuid, fields, actorOf(req, staff))
      },
    })
    const rows = req.auth?.channel === "pos" ? await posTransfers(data.created) : data.created
    return bulkUpdateResponse(res, data, message, rows)
  })
}

/** PATCH /stock-transfers/bulk — what is still on the way: products [{ product_id, to_location_id?, qty }], note. */
export const patchBulk = bulkTransferUpdate("Stock Transfers Updated", (req, uuid, fields) =>
  transferService.updateTransfer(req.storeId, uuid, {
    products: fields.products,
    qty: fields.qty,
    to_location_id: fields.to_location_id ?? fields.toLocationId,
    note: fields.note,
  })
)

/** PATCH /stock-transfers/bulk/qty — { id, products: [{ product_id, to_location_id?, qty }] } (or qty for one product). */
export const patchBulkQty = bulkTransferUpdate("Stock Transfer Qty Updated", (req, uuid, fields) => {
  if (fields.qty === undefined && !Array.isArray(fields.products)) throw new AppError("products or qty is required", 400)
  return transferService.updateTransfer(req.storeId, uuid, { products: fields.products, qty: fields.qty })
})

/** PATCH /stock-transfers/bulk/status — { id, status: completed | cancelled, to_location_id? }. */
export const patchBulkStatus = bulkTransferUpdate("Stock Transfer Status Updated", (req, uuid, fields, actor) => {
  const scope = parseReceive(fields)
  if (fields.status === "completed") return transferService.receiveTransfer(req.storeId, uuid, actor, scope)
  if (fields.status === "cancelled") return transferService.cancelTransfer(req.storeId, uuid, scope, actor)
  throw new AppError("status must be completed or cancelled", 400)
})

/** PATCH /stock-transfers/bulk/receive — { id, to_location_id?, products: [{ product_id, received_qty }], note? }. */
export const patchBulkReceive = bulkTransferUpdate("Stock Transfers Received", (req, uuid, fields, actor) => {
  const scope = parseReceive(fields)
  if (!scope.products && scope.received_qty === undefined) {
    throw new AppError("products [{ product_id, received_qty }] (or received_qty) is required", 400)
  }
  return transferService.receiveTransfer(req.storeId, uuid, actor, scope)
})
