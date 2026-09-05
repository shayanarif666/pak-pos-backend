import { ApprovalRequest } from "./approvalRequest.model.js"
import { getStoreForManager } from "../stores/store.service.js"
import { assertPlan, hasPlanFeature } from "../../shared/utils/plan.util.js"
import { getLocation } from "../locations/location.service.js"
import { writeAudit } from "../../shared/utils/audit.util.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

export async function assertApprovalEnabled(store) {
  return assertPlan(store, "approval_enabled")
}

export async function assertPinOverrideEnabled(store) {
  return assertPlan(store, "pin_override_enabled")
}

export async function createRequest(actor, fields) {
  const store = await getStoreForManager(actor.store_id)
  await assertApprovalEnabled(store)
  const locationId = fields.location_id || actor.location_id
  if (!locationId) throw new AppError("location_id is required", 400)
  const location = await getLocation(store.id, locationId)

  const row = await ApprovalRequest.create({
    store_id: store.id,
    location_id: location.id,
    type: fields.type,
    status: "pending",
    requested_by: actor.id,
    order_id: fields.order_id,
    payload: fields.payload,
    reason: fields.reason,
  })
  return row
}

export async function listRequests(actor, query = {}) {
  const store = await getStoreForManager(actor.store_id)
  await assertApprovalEnabled(store)
  const where = { store_id: actor.store_id }
  if (actor.role === "manager") where.location_id = actor.location_id
  if (query.status) where.status = query.status
  else where.status = "pending"
  if (query.type) where.type = query.type
  return ApprovalRequest.findAll({
    where,
    order: [["created_at", "DESC"]],
  })
}

async function getRequest(storeId, id) {
  const row = await ApprovalRequest.findOne({
    where: { id, store_id: storeId },
  })
  if (!row) throw new NotFoundError("Approval request not found")
  return row
}

export async function reviewRequest(actor, id, fields) {
  const store = await getStoreForManager(actor.store_id)
  await assertApprovalEnabled(store)
  const row = await getRequest(store.id, id)
  if (actor.role === "manager" && row.location_id !== actor.location_id) {
    throw new NotFoundError("Approval request not found")
  }
  if (row.status !== "pending") {
    throw new ConflictError("Request is already reviewed")
  }
  if (fields.pin && actor.pin && fields.pin !== actor.pin) {
    throw new AppError("Invalid PIN", 400)
  }

  await row.update({
    status: fields.status,
    reviewed_by: actor.id,
    review_note: fields.review_note,
  })

  await writeAudit({
    action: fields.status === "approved" ? "approve" : "reject",
    entity_type: "approval_requests",
    entity_id: row.id,
    store_id: store.id,
    store_id_int: store.store_id_int,
    location_id: row.location_id,
    user_id: actor.id,
    channel: "pos",
    note: row.type,
  })

  return row
}

export async function pinOverride(actor, fields) {
  const store = await getStoreForManager(actor.store_id)
  await assertPinOverrideEnabled(store)
  if (actor.pin !== fields.pin) throw new AppError("Invalid PIN", 400)
  const locationId =
    fields.location_id || actor.location_id || fields.payload?.location_id
  if (!locationId) throw new AppError("location_id is required", 400)
  const location = await getLocation(store.id, locationId)

  const row = await ApprovalRequest.create({
    store_id: store.id,
    location_id: location.id,
    type: fields.type,
    status: "approved",
    requested_by: actor.id,
    reviewed_by: actor.id,
    order_id: fields.order_id,
    payload: fields.payload,
    reason: fields.reason,
    review_note: "PIN override",
  })

  await writeAudit({
    action: "pin_override",
    entity_type: "approval_requests",
    entity_id: row.id,
    store_id: store.id,
    store_id_int: store.store_id_int,
    location_id: location.id,
    location_id_int: location.location_id_int,
    user_id: actor.id,
    channel: "pos",
    note: fields.type,
  })

  return row
}

export async function requireApprovedAction({
  store,
  actor,
  type,
  orderId,
  approvalRequestId,
}) {
  const { plan, enabled } = await hasPlanFeature(store, "approval_enabled")
  if (!enabled) {
    if (actor.role === "cashier") {
      throw new ForbiddenError("A manager must perform this action")
    }
    return null
  }
  if (["store_admin", "manager"].includes(actor.role)) return null
  if (!approvalRequestId) {
    throw new ForbiddenError("Approval is required")
  }
  const row = await getRequest(store.id, approvalRequestId)
  if (row.status !== "approved") {
    throw new ForbiddenError("Approval is not granted")
  }
  if (row.type !== type) throw new AppError("Approval type does not match", 400)
  if (orderId && row.order_id && row.order_id !== orderId) {
    throw new AppError("Approval is for a different order", 400)
  }
  return row
}
