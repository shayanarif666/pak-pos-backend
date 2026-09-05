import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import {
  parseAddCartItem,
  parsePatchCartItem,
  parsePutCart,
} from "./cart.validation.js"
import {
  addItem,
  emptyCart,
  getCart,
  patchItem,
  putCart,
  removeItem,
} from "./cart.controller.js"

const router = Router()
const customer = [
  authMiddleware,
  tenantMiddleware,
  requireTenantStore,
  authorize("customer"),
]

router.get("/", ...customer, getCart)
router.put("/", ...customer, validate(parsePutCart), putCart)
router.delete("/", ...customer, emptyCart)
router.post("/items", ...customer, validate(parseAddCartItem), addItem)
router.patch("/items/:id", ...customer, validate(parsePatchCartItem), patchItem)
router.delete("/items/:id", ...customer, removeItem)

export default router
