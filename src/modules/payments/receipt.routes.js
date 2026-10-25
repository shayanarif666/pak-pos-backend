import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { generate, getOne } from "./receipt.controller.js"

const router = Router()

router.post(
  "/",
  authMiddleware,
  authorize("store_admin", "manager"),
  tenantMiddleware,
  requireTenantStore,
  generate
)

router.get(
  "/:id",
  authMiddleware,
  authorize("store_admin", "manager", "cashier"),
  tenantMiddleware,
  requireTenantStore,
  getOne
)

export default router
