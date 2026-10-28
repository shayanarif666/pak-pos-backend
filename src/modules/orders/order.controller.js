import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { bulkStatus, posBulkResponse, extractBulkItems, runBulk } from "../../shared/utils/bulk.util.js"
import {
  parseBulkRefundComplete,
  parseBulkRefundItem,
  parseCreateOrder,
  parseVoidCancel,
} from "./order.validation.js"
import * as orderService from "./order.service.js"
import { orderIdFromRef, resolveOrderRefs } from "./orderRefs.js"
import { actingAs, resolveStaff } from "../../shared/utils/staff.util.js"
import { posOrder, posOrders, posRefund, posRefunds } from "../pos/posResponses.js"
import { loadLocation } from "../catalog/productStock.service.js"
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { bulkLocation } from "../../shared/utils/location.util.js"
import { Order } from "./order.model.js"
import * as posHistory from "../pos/posHistory.service.js"
import { Customer } from "../customers/customer.model.js"
import { PAYMENT_METHOD } from "../../db/enums.js"
import { AppError } from "../../shared/errors/AppError.js"
import { bulkUpdateResponse, uuidOfNumber } from "../../shared/utils/bulkUpdate.util.js"

const isPos = (req) => req.auth?.channel === "pos"

/** The token's actor, acting as the PIN-picked staff member when the body names one. */
async function staffActor(req, staffRef) {
  const actor = actorFromReq(req)
  return actingAs(actor, await resolveStaff(actor.store_id, staffRef, req.user))
}

/** POS shape of an order (placeOrder returns { order, ... }). */
async function orderSummary(data) {
  return posOrder(data.order?.id)
}

/** POS shape of one item refund, or of a complete refund (its refunds added up, items joined). */
async function refundSummary(data) {
  if (data.refund) return posRefund(data.refund.id)
  const rows = await posRefunds((data.refunds || []).map((row) => row.refund.id))
  if (!rows.length) return null
  const sum = (key) => Number(rows.reduce((total, row) => total + Number(row[key] || 0), 0).toFixed(2))
  return { ...rows[0], items: rows.flatMap((row) => row.items), amount: sum("amount"), tax: sum("tax"), total: sum("total") }
}

function actorFromReq(req) {
  const user = req.user
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    store_id: req.auth?.store_id || user.store_id,
    location_id: req.auth?.location_id || user.location_id,
    store_id_int: user.store_id_int,
    location_id_int: user.location_id_int,
    device_id: req.auth?.device_id || null,
    channel: req.auth?.channel || null,
  }
}

export const create = asyncHandler(async (req, res) => {
  const { staff_ref, ...input } = req.body
  const actor = await staffActor(req, staff_ref)
  const data = await orderService.placeOrder(actor, await resolveOrderRefs(actor.store_id, input))
  const status = data.idempotent ? 200 : 201
  if (isPos(req)) return apiResponse(res, status, "Order Created", await orderSummary(data))
  return apiResponse(res, status, data.idempotent ? "Existing order" : "Order created", data)
})

/**
 * An order's locationId (number or UUID) as its location. A store admin may sell at any
 * location; a manager / cashier only at their own. Not sent = the request's location.
 */
async function orderLocation(base, ref) {
  if (ref === undefined || ref === null || String(ref).trim() === "") return null
  const location = await loadLocation(base.store_id, String(ref).trim())
  if (base.role !== "store_admin" && location.id !== base.location_id) {
    throw new ForbiddenError("You can only place orders at your own location")
  }
  return location
}

export const createBulk = asyncHandler(async (req, res) => {
  const base = actorFromReq(req)
  // staff_id may be sent once next to items[] or on each order.
  const fallbackStaff = req.body?.staff_id ?? req.body?.staffId ?? null
  // locationId once next to items[] for every order (an order may still name its own).
  const topLocation = await bulkLocation(req)
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    const { locationId, location_id, ...orderBody } = item || {}
    const location = (await orderLocation(base, locationId ?? location_id)) || topLocation
    const { staff_ref, ...input } = parseCreateOrder(orderBody)
    const actor = actingAs(
      location ? { ...base, location_id: location.id, location_id_int: location.location_id_int } : base,
      await resolveStaff(base.store_id, staff_ref || (fallbackStaff == null ? null : String(fallbackStaff)), req.user)
    )
    // /orders/bulk is the offline-sync endpoint of the desktop POS.
    return orderService.placeOrder(actor, {
      ...(await resolveOrderRefs(base.store_id, input)),
      ...(location ? { location_id: location.id } : {}),
      offline: true,
    })
  })
  if (isPos(req)) {
    const created = []
    created.push(...(await posOrders(data.created.map((row) => row.order?.id))))
    return posBulkResponse(res, data, "Order Created", created)
  }
  return apiResponse(res, bulkStatus(data), "Bulk orders processed", data)
})

export const list = asyncHandler(async (req, res) => {
  if (req.auth?.channel === "pos") return posHistory.sendPage(res, await posHistory.orders(req))
  const data = await orderService.listOrders(actorFromReq(req), req.query)
  return apiResponse(res, 200, "OK", data)
})

export const listCustom = asyncHandler(async (req, res) => {
  const data = await orderService.listCustomOrders(actorFromReq(req), req.query)
  return apiResponse(res, 200, "OK", data)
})

export const listCancelled = asyncHandler(async (req, res) => {
  const data = await orderService.listCancelledOrders(actorFromReq(req), req.query)
  return apiResponse(res, 200, "OK", data)
})

export const salesByLocation = asyncHandler(async (req, res) => {
  const data = await orderService.salesByLocation(actorFromReq(req), req.query)
  return apiResponse(res, 200, "OK", data)
})

export const listRefunds = asyncHandler(async (req, res) => {
  if (req.auth?.channel === "pos") return posHistory.sendPage(res, await posHistory.refunds(req))
  const data = await orderService.listOrderRefunds(actorFromReq(req), req.query)
  return apiResponse(res, 200, "OK", data)
})

export const getOne = asyncHandler(async (req, res) => {
  if (isPos(req)) return apiResponse(res, 200, "OK", await posHistory.orderDetail(req, req.params.id))
  const data = await orderService.getOrderView(actorFromReq(req), req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const voidOne = asyncHandler(async (req, res) => {
  const data = await orderService.voidOrder(actorFromReq(req), req.params.id, req.body)
  return apiResponse(res, 200, "Order voided", data)
})

export const cancel = asyncHandler(async (req, res) => {
  const data = await orderService.cancelOrder(actorFromReq(req), req.params.id, req.body)
  return apiResponse(res, 200, "Order cancelled", data)
})

export const listPayments = asyncHandler(async (req, res) => {
  const data = await orderService.listOrderPayments(actorFromReq(req), req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const addPayment = asyncHandler(async (req, res) => {
  const data = await orderService.addOrderPayment(
    actorFromReq(req),
    req.params.id,
    req.body
  )
  return apiResponse(res, 201, "Payment added", data)
})

export const receipt = asyncHandler(async (req, res) => {
  if (isPos(req)) return apiResponse(res, 200, "OK", await posHistory.orderReceipt(req, req.params.id))
  const data = await orderService.getOrderReceipt(actorFromReq(req), req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const refundItem = asyncHandler(async (req, res) => {
  const { staff_ref, ...fields } = req.body
  const actor = await staffActor(req, staff_ref)
  const data = await orderService.refundOrderItem(
    actor,
    await orderIdFromRef(actor.store_id, req.params.id),
    fields
  )
  if (isPos(req)) return apiResponse(res, 201, "Refunded Successfully", await refundSummary(data))
  return apiResponse(res, 201, "Item refunded", data)
})

export const refundComplete = asyncHandler(async (req, res) => {
  const { staff_ref, ...fields } = req.body
  const actor = await staffActor(req, staff_ref)
  const data = await orderService.refundEntireOrder(
    actor,
    await orderIdFromRef(actor.store_id, req.params.id),
    fields
  )
  if (isPos(req)) return apiResponse(res, 201, "Refunded Successfully", await refundSummary(data))
  return apiResponse(res, 201, "Order refunded", data)
})

/** The order's UUID; with a bulk locationId the order must be at that location. */
async function orderAt(storeId, ref, location) {
  const id = await orderIdFromRef(storeId, ref)
  if (!location) return id
  const order = await Order.findOne({ where: { id, store_id: storeId }, attributes: ["location_id"] })
  if (!order || order.location_id !== location.id) throw new NotFoundError("Order not found at this location")
  return id
}

export const refundItemsBulk = asyncHandler(async (req, res) => {
  const location = await bulkLocation(req)
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    const { staff_ref, ...parsed } = parseBulkRefundItem(item)
    const actor = await staffActor(req, staff_ref || req.body?.staff_id || req.body?.staffId)
    return orderService.refundOrderItem(actor, await orderAt(actor.store_id, parsed.order_id, location), parsed)
  })
  if (isPos(req)) {
    const created = []
    for (const row of data.created) created.push(await refundSummary(row))
    return posBulkResponse(res, data, "Refunded Successfully", created)
  }
  return apiResponse(res, bulkStatus(data), "Bulk item refunds processed", data)
})

export const refundCompleteBulk = asyncHandler(async (req, res) => {
  const location = await bulkLocation(req)
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    const { staff_ref, ...parsed } = parseBulkRefundComplete(item)
    const actor = await staffActor(req, staff_ref || req.body?.staff_id || req.body?.staffId)
    return orderService.refundEntireOrder(actor, await orderAt(actor.store_id, parsed.order_id, location), parsed)
  })
  if (isPos(req)) {
    const created = []
    for (const row of data.created) created.push(await refundSummary(row))
    return posBulkResponse(res, data, "Refunded Successfully", created)
  }
  return apiResponse(res, bulkStatus(data), "Bulk order refunds processed", data)
})

/** GET /orders/refunds/:refundId/receipt — a refund's receipt by the refund number or UUID. */
export const refundReceiptById = asyncHandler(async (req, res) => {
  return apiResponse(res, 200, "OK", await posHistory.refundReceipt(req, req.params.refundId))
})

export const refundReceipt = asyncHandler(async (req, res) => {
  const data = await orderService.getRefundReceipt(
    actorFromReq(req),
    req.params.id,
    req.params.refundId
  )
  return apiResponse(res, 200, "OK", data)
})

// ---- Bulk updates (POS offline sync): { locationId?, items: [{ id (order number), ... }] } ----
// Totals, items and taxes of a sale never change: a wrong item is a refund (+ a new sale).

const ORDER_STATUS_UPDATES = ["completed", "cancelled", "voided"]

function bulkOrderUpdate(message, handler) {
  return asyncHandler(async (req, res) => {
    const location = await bulkLocation(req)
    const fallbackStaff = req.body?.staff_id ?? req.body?.staffId ?? null
    const data = await runBulk(extractBulkItems(req.body), async (item) => {
      if (!item || typeof item !== "object") throw new AppError("Each item must be an object", 400)
      const ref = item.staff_id ?? item.staffId ?? fallbackStaff
      const actor = await staffActor(req, ref == null ? null : String(ref))
      if (item.id === undefined || item.id === null || item.id === "") throw new AppError("Order id is required", 400)
      return handler(actor, await orderAt(actor.store_id, item.id, location), item)
    })
    const rows = isPos(req) ? await posOrders(data.created.map((row) => row.id)) : data.created
    return bulkUpdateResponse(res, data, message, rows)
  })
}

/** PATCH /orders/bulk — { id, customer_id }: attach the customer the cashier forgot to pick. */
export const patchBulk = bulkOrderUpdate("Orders Updated", async (actor, id, item) => {
  const ref = item.customer_id ?? item.customerId
  if (ref === undefined || ref === null || ref === "") throw new AppError("customer_id is required", 400)
  const customerId = await uuidOfNumber(Customer, "customer_number", actor.store_id, ref, "Customer")
  return orderService.attachOrderCustomer(actor, id, customerId)
})

/**
 * PATCH /orders/bulk/status — { id, status, reason?, approval_request_id? }:
 * completed (a pending web / COD order delivered and paid), cancelled (a pending order),
 * voided (a completed sale; stock goes back, a cashier needs an approval).
 */
export const patchBulkStatus = bulkOrderUpdate("Order Status Updated", async (actor, id, item) => {
  if (!ORDER_STATUS_UPDATES.includes(item.status)) {
    throw new AppError(`status must be one of: ${ORDER_STATUS_UPDATES.join(", ")}`, 400)
  }
  if (item.status === "completed") return orderService.completePendingOrder(actor, id)
  const fields = parseVoidCancel(item)
  if (item.status === "cancelled") return orderService.cancelOrder(actor, id, fields)
  return orderService.voidOrder(actor, id, fields)
})

/** PATCH /orders/bulk/payment-method — { id, payment_method }: the wrong method was pressed. */
export const patchBulkPaymentMethod = bulkOrderUpdate("Payment Method Updated", async (actor, id, item) => {
  const method = item.payment_method ?? item.method
  if (!PAYMENT_METHOD.includes(method) || method === "mixed") throw new AppError("Invalid payment_method", 400)
  return orderService.changePaymentMethod(actor, id, method)
})
