import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as orderService from "./order.service.js"

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
  }
}

export const create = asyncHandler(async (req, res) => {
  const data = await orderService.placeOrder(actorFromReq(req), req.body)
  const message = data.idempotent ? "Existing order" : "Order created"
  return apiResponse(res, data.idempotent ? 200 : 201, message, data)
})

export const list = asyncHandler(async (req, res) => {
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

export const listRefunds = asyncHandler(async (req, res) => {
  const data = await orderService.listOrderRefunds(actorFromReq(req), req.query)
  return apiResponse(res, 200, "OK", data)
})

export const getOne = asyncHandler(async (req, res) => {
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
  const data = await orderService.getOrderReceipt(actorFromReq(req), req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const refundItem = asyncHandler(async (req, res) => {
  const data = await orderService.refundOrderItem(
    actorFromReq(req),
    req.params.id,
    req.body
  )
  return apiResponse(res, 201, "Item refunded", data)
})

export const refundReceipt = asyncHandler(async (req, res) => {
  const data = await orderService.getRefundReceipt(
    actorFromReq(req),
    req.params.id,
    req.params.refundId
  )
  return apiResponse(res, 200, "OK", data)
})
