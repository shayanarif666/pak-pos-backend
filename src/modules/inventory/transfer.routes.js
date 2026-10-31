import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { requestScope } from "../../shared/middlewares/requestScope.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import { parseCreateTransfer } from "./transfer.validation.js"
import {
  cancel,
  complete,
  create,
  createBulk,
  list,
  patchBulk,
  patchBulkQty,
  patchBulkReceive,
  patchBulkStatus,
} from "./transfer.controller.js"

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
  requestScope(),
  validate(parseCreateTransfer),
  create
)
router.post("/bulk", ...tenant, authorize("store_admin"), requestScope(), createBulk)
// Bulk updates (POS offline sync): items[] = [{ id (transfer number), ...fields }].
router.patch("/bulk", ...tenant, authorize("store_admin"), patchBulk)
router.patch("/bulk/qty", ...tenant, authorize("store_admin"), patchBulkQty)
router.patch("/bulk/status", ...tenant, authorize("store_admin", "manager"), patchBulkStatus)
router.patch("/bulk/receive", ...tenant, authorize("store_admin", "manager"), patchBulkReceive)
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
