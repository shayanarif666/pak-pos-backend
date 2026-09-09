import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { breakdown, dashboard, exportOne, payments, profit, sales } from "./reports.controller.js"

const router = Router()
const staff = [
  authMiddleware,
  tenantMiddleware,
  requireTenantStore,
  authorize("store_admin", "manager", "cashier"),
]

router.get("/breakdown", ...staff, breakdown)
router.get("/dashboard", ...staff, dashboard)
router.get("/sales", ...staff, sales)
router.get("/payments", ...staff, payments)
router.get("/profit", ...staff, profit)
router.get(
  "/export",
  authMiddleware,
  tenantMiddleware,
  requireTenantStore,
  authorize("store_admin", "manager"),
  exportOne
)

export default router
