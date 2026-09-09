import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import { parsePatchDevice, parseRegisterDevice } from "./posDevice.validation.js"
import { heartbeat, list, patch, register } from "./posDevice.controller.js"

const router = Router()
const tenant = [authMiddleware, tenantMiddleware, requireTenantStore]

router.get(
  "/",
  ...tenant,
  authorize("store_admin", "manager"),
  list
)
router.post(
  "/",
  ...tenant,
  authorize("store_admin", "manager"),
  validate(parseRegisterDevice),
  register
)
router.patch(
  "/:id/heartbeat",
  ...tenant,
  authorize("store_admin", "manager", "cashier"),
  heartbeat
)
router.patch(
  "/:id",
  ...tenant,
  authorize("store_admin"),
  validate(parsePatchDevice),
  patch
)

export default router
