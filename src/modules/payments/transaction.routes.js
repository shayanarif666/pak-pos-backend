import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as posHistory from "../pos/posHistory.service.js"

const router = Router()

// The orders' transactions (one per payment, created with the order): ?orderId, method, status,
// from, to, location_id (store admin).
router.get(
  "/",
  authMiddleware,
  authorize("store_admin", "manager", "cashier"),
  tenantMiddleware,
  requireTenantStore,
  asyncHandler(async (req, res) => posHistory.sendPage(res, await posHistory.transactions(req)))
)

export default router
