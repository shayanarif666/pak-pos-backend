import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { bulkStatus, posBulkResponse, extractBulkItems, runBulk } from "../../shared/utils/bulk.util.js"
import { bulkUpdateResponse } from "../../shared/utils/bulkUpdate.util.js"
import { AppError } from "../../shared/errors/AppError.js"
import { stockEditRows } from "./stockEditView.js"
import { parseCreateMovement, parsePatchMovement } from "./stock.validation.js"
import * as stockService from "./stock.service.js"
import { StockMovement } from "./stockMovement.model.js"
import { Supplier } from "./supplier.model.js"
import { actingAs, resolveStaff } from "../../shared/utils/staff.util.js"
import { posStockMovement, posStockMovements } from "../pos/posResponses.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { bulkLocation } from "../../shared/utils/location.util.js"
import * as posHistory from "../pos/posHistory.service.js"

/** The movement fields with the staff member acting and the supplier as a UUID. */
async function prepare(req, base, { staff_ref, supplier_ref, ...fields }, fallbackStaff = null) {
  const staff = await resolveStaff(base.store_id, staff_ref || fallbackStaff, req.user)
  let supplier_id = null
  if (supplier_ref) {
    const where = /^\d+$/.test(supplier_ref)
      ? { store_id: base.store_id, supplier_number: Number(supplier_ref) }
      : { store_id: base.store_id, id: supplier_ref }
    const supplier = await Supplier.findOne({ where, attributes: ["id"] })
    if (!supplier) throw new NotFoundError("Supplier not found")
    supplier_id = supplier.id
  }
  // The movement is written in the staff member's name, but which locations may be used follows
  // the signed-in user: a store admin picking a manager / cashier still moves stock anywhere.
  return { actor: { ...actingAs(base, staff), role: base.role }, fields: { ...fields, supplier_id } }
}

async function movementSummary(result) {
  const row = result.movement ? await StockMovement.findByPk(result.movement.id) : null
  return row ? posStockMovement(row) : null
}

export const list = asyncHandler(async (req, res) => {
  if (req.auth?.channel === "pos") return posHistory.sendPage(res, await posHistory.stockMovements(req))
  const data = await stockService.listMovements(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const create = asyncHandler(async (req, res) => {
  const { actor, fields } = await prepare(req, movementActor(req), req.body)
  const { created, failed } = await stockService.createMovements(actor, fields)
  if (!created.length) {
    const first = failed[0]
    return res.status(first?.status || 400).json({ success: false, message: first?.message || "Failed", failed })
  }
  if (req.auth?.channel === "pos") {
    const rows = await Promise.all(created.map((result) => movementSummary(result)))
    return apiResponse(res, 201, "Stock Movement Created", rows.length === 1 && !failed.length ? rows[0] : rows)
  }
  const data = created.map(({ summary: _summary, ...row }) => row)
  if (data.length === 1 && !failed.length) return apiResponse(res, 201, "Stock movement recorded", data[0])
  return apiResponse(res, 201, "Stock movements recorded", { created: data, failed })
})

function movementActor(req) {
  return {
    ...req.user.get({ plain: true }),
    store_id: req.auth?.store_id || req.user.store_id,
    location_id: req.auth?.location_id || req.user.location_id,
  }
}

export const createBulk = asyncHandler(async (req, res) => {
  // locationId once next to items[] (any role; a manager / cashier only their own).
  const location = await bulkLocation(req)
  const base = location
    ? { ...movementActor(req), location_id: location.id, location_id_int: location.location_id_int }
    : movementActor(req)
  // staff_id may be sent once next to items[] or on each movement.
  const fallbackStaff = req.body?.staff_id ?? req.body?.staffId ?? null
  // Each item is one product; it may move several variants / locations (one movement each).
  // A failed variant / location is listed in failed[] with the item's index; the rest still save.
  const items = extractBulkItems(req.body)
  const moved = []
  const failed = []
  for (let index = 0; index < items.length; index += 1) {
    try {
      const { actor, fields } = await prepare(
        req,
        base,
        parseCreateMovement(items[index]),
        fallbackStaff == null ? null : String(fallbackStaff)
      )
      const result = await stockService.createMovements(actor, fields)
      moved.push(...result.created)
      failed.push(...result.failed.map((row) => ({ index, ...row })))
    } catch (err) {
      failed.push({ index, message: err.message || "Failed", status: err.statusCode || err.status || 400 })
    }
  }
  const data = { created: moved, failed, created_count: moved.length, failed_count: failed.length }
  if (req.auth?.channel === "pos") {
    // Every created movement in one query, shaped together.
    const ids = moved.map((row) => row.movement?.id).filter(Boolean)
    const rows = ids.length ? await StockMovement.findAll({ where: { id: ids } }) : []
    const byId = new Map(rows.map((row) => [row.id, row]))
    const shaped = await posStockMovements(ids.map((id) => byId.get(id)).filter(Boolean))
    return posBulkResponse(res, data, "Stock Movement Created", shaped)
  }
  const created = moved.map(({ summary: _summary, ...row }) => row)
  return apiResponse(res, bulkStatus(data), "Bulk stock movements processed", { ...data, created })
})

/** PATCH /stock-movements/:id (movement number or UUID) — fixes a wrong movement; the stock follows. */
/**
 * PATCH /stock-movements/bulk — { items: [{ id (movement number), movement_type?, reason?, qty?,
 * reason_note? }] }, one item or many. Each row saves on its own (a failed one is listed in
 * failed[]); data = [{ movement, stock }] with short numbers only.
 */
export const patchBulk = asyncHandler(async (req, res) => {
  const actor = movementActor(req)
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new AppError("Each item must be an object", 400)
    const { id, ...fields } = item
    if (id === undefined || id === null || String(id).trim() === "") throw new AppError("id (the movement number) is required", 400)
    return stockService.updateMovement(actor, id, parsePatchMovement(fields))
  })
  return bulkUpdateResponse(res, data, "Stock Movements Updated", await stockEditRows(data.created))
})

/** DELETE /stock-movements/:id — soft delete; its qty is taken back off the stock. */
export const remove = asyncHandler(async (req, res) => {
  const result = await stockService.deleteMovement(movementActor(req), req.params.id)
  const [data] = await stockEditRows([result])
  return apiResponse(res, 200, "Stock Movement Deleted", data)
})
