import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { bulkStatus, posBulkResponse, extractBulkItems, runBulk } from "../../shared/utils/bulk.util.js"
import { parseCreateMovement } from "./stock.validation.js"
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
  return { actor: actingAs(base, staff), fields: { ...fields, supplier_id } }
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
  const result = await stockService.createMovement(actor, fields)
  const { summary: _summary, ...data } = result
  if (req.auth?.channel === "pos") {
    return apiResponse(res, 201, "Stock Movement Created", await movementSummary(result))
  }
  return apiResponse(res, 201, "Stock movement recorded", data)
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
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    const { actor, fields } = await prepare(
      req,
      base,
      parseCreateMovement(item),
      fallbackStaff == null ? null : String(fallbackStaff)
    )
    return stockService.createMovement(actor, fields)
  })
  if (req.auth?.channel === "pos") {
    const created = []
    // Every created movement in one query, shaped together.
    const ids = data.created.map((row) => row.movement?.id).filter(Boolean)
    const rows = ids.length ? await StockMovement.findAll({ where: { id: ids } }) : []
    const byId = new Map(rows.map((row) => [row.id, row]))
    created.push(...(await posStockMovements(ids.map((id) => byId.get(id)).filter(Boolean))))
    return posBulkResponse(res, data, "Stock Movement Created", created)
  }
  const created = data.created.map(({ summary, ...row }) => row)
  return apiResponse(res, bulkStatus(data), "Bulk stock movements processed", { ...data, created })
})
