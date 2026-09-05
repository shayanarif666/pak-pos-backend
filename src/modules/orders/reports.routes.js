import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { exportOne, payments, profit, sales } from "./reports.controller.js"

const router = Router()
const manage = [
  authMiddleware,
  tenantMiddleware,
  requireTenantStore,
  authorize("store_admin", "manager"),
]

router.get("/sales", ...manage, sales)
router.get("/payments", ...manage, payments)
router.get("/profit", ...manage, profit)
router.get("/export", ...manage, exportOne)

export default router
