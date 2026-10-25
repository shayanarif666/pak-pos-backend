import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import { parsePutCurrency } from "./currency.validation.js"
import { get, put } from "./currency.controller.js"

const router = Router()

router.get(
  "/",
  authMiddleware,
  authorize("store_admin", "manager", "cashier"),
  tenantMiddleware,
  requireTenantStore,
  get
)
router.put(
  "/",
  authMiddleware,
  authorize("store_admin", "manager"),
  tenantMiddleware,
  requireTenantStore,
  validate(parsePutCurrency),
  put
)

export default router
