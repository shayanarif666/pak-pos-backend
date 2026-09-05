import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import { parseCreateBackup } from "./backup.validation.js"
import { create, list, restore } from "./backup.controller.js"

const router = Router()

router.get(
  "/",
  authMiddleware,
  authorize("store_admin"),
  tenantMiddleware,
  requireTenantStore,
  list
)
router.post(
  "/",
  authMiddleware,
  authorize("store_admin"),
  tenantMiddleware,
  requireTenantStore,
  validate(parseCreateBackup),
  create
)
router.post(
  "/:id/restore",
  authMiddleware,
  authorize("store_admin", "superadmin"),
  restore
)

export default router
