import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as orderService from "./order.service.js"

export const create = asyncHandler(async (req, res) => {
  const data = await orderService.placeOrder(req.user, req.body)
  const message = data.idempotent ? "Existing order" : "Order created"
  return apiResponse(res, data.idempotent ? 200 : 201, message, data)
})

export const list = asyncHandler(async (req, res) => {
  const data = await orderService.listOrders(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const listCustom = asyncHandler(async (req, res) => {
  const data = await orderService.listCustomOrders(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const listCancelled = asyncHandler(async (req, res) => {
  const data = await orderService.listCancelledOrders(req.user, req.query)
  return apiResponse(res, 200, "OK", data)
})

export const getOne = asyncHandler(async (req, res) => {
  const data = await orderService.getOrderView(req.user, req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const voidOne = asyncHandler(async (req, res) => {
  const data = await orderService.voidOrder(req.user, req.params.id, req.body)
  return apiResponse(res, 200, "Order voided", data)
})

export const cancel = asyncHandler(async (req, res) => {
  const data = await orderService.cancelOrder(req.user, req.params.id, req.body)
  return apiResponse(res, 200, "Order cancelled", data)
})

export const listPayments = asyncHandler(async (req, res) => {
  const data = await orderService.listOrderPayments(req.user, req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const addPayment = asyncHandler(async (req, res) => {
  const data = await orderService.addOrderPayment(
    req.user,
    req.params.id,
    req.body
  )
  return apiResponse(res, 201, "Payment added", data)
})

export const receipt = asyncHandler(async (req, res) => {
  const data = await orderService.getOrderReceipt(req.user, req.params.id)
  return apiResponse(res, 200, "OK", data)
})
