import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import { parseCreateMovement } from "./stock.validation.js"
import { create, createBulk, list } from "./stock.controller.js"

const router = Router()

router.use(
  authMiddleware,
  authorize("store_admin", "manager"),
  tenantMiddleware,
  requireTenantStore
)

router.get("/", list)
router.post("/", validate(parseCreateMovement), create)
router.post("/bulk", createBulk)

export default router
