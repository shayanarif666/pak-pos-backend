import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import { parsePutTaxRates } from "./taxRate.validation.js"
import { list, put } from "./taxRate.controller.js"

const router = Router()

router.get(
  "/",
  authMiddleware,
  authorize("store_admin", "manager", "cashier"),
  tenantMiddleware,
  requireTenantStore,
  list
)
router.put(
  "/",
  authMiddleware,
  authorize("store_admin", "manager"),
  tenantMiddleware,
  requireTenantStore,
  validate(parsePutTaxRates),
  put
)

export default router
