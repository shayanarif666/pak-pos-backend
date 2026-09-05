import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import { parseCreateStaff, parsePatchStaff } from "./staff.validation.js"
import { create, getOne, list, patch, sales } from "./staff.controller.js"

const router = Router()

router.use(
  authMiddleware,
  authorize("store_admin", "manager"),
  tenantMiddleware,
  requireTenantStore
)

router.get("/", list)
router.post("/", validate(parseCreateStaff), create)
router.get("/:id/sales", sales)
router.get("/:id", getOne)
router.patch("/:id", validate(parsePatchStaff), patch)

export default router
