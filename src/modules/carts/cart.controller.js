import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as cartService from "./cart.service.js"

export const getCart = asyncHandler(async (req, res) => {
  const data = await cartService.getCartView(req.user)
  return apiResponse(res, 200, "OK", data)
})

export const putCart = asyncHandler(async (req, res) => {
  const data = await cartService.setCartCoupon(req.user, req.body)
  return apiResponse(res, 200, "Cart updated", data)
})

export const emptyCart = asyncHandler(async (req, res) => {
  const data = await cartService.clearCart(req.user)
  return apiResponse(res, 200, "Cart cleared", data)
})

export const addItem = asyncHandler(async (req, res) => {
  const data = await cartService.addCartItem(req.user, req.body)
  return apiResponse(res, 201, "Item added", data)
})

export const patchItem = asyncHandler(async (req, res) => {
  const data = await cartService.updateCartItem(req.user, req.params.id, req.body)
  return apiResponse(res, 200, "Item updated", data)
})

export const removeItem = asyncHandler(async (req, res) => {
  const data = await cartService.removeCartItem(req.user, req.params.id)
  return apiResponse(res, 200, "Item removed", data)
})
