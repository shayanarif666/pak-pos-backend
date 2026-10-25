import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { clockIn, clockOut, list } from "./staffSession.controller.js"

const router = Router()

// Only a store admin or manager holds a token; they clock in themselves or the cashier picked by PIN.
router.use(authMiddleware, authorize("store_admin", "manager"), tenantMiddleware, requireTenantStore)

router.get("/", list)
router.post("/clock-in", clockIn)
router.post("/clock-out", clockOut)

export default router
