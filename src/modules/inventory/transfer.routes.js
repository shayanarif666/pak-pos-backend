import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import { parseCreateTransfer } from "./transfer.validation.js"
import { cancel, complete, create, list } from "./transfer.controller.js"

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
  authorize("store_admin"),
  validate(parseCreateTransfer),
  create
)
router.post(
  "/:id/complete",
  ...tenant,
  authorize("store_admin"),
  complete
)
router.post(
  "/:id/cancel",
  ...tenant,
  authorize("store_admin"),
  cancel
)

export default router
