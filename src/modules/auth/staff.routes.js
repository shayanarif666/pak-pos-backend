import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { requestScope } from "../../shared/middlewares/requestScope.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import { parseCreateStaff, parsePatchStaff } from "./staff.validation.js"
import {
  create,
  createBulk,
  getOne,
  list,
  patch,
  patchBulk,
  patchBulkLocation,
  patchBulkPassword,
  patchBulkStatus,
  remove,
  sales,
} from "./staff.controller.js"

const router = Router()

router.use(
  authMiddleware,
  authorize("store_admin", "manager"),
  tenantMiddleware,
  requireTenantStore
)

router.get("/", list)
router.post("/", validate(parseCreateStaff), create)
// Each staff item names its own location; only storeId is taken from the top.
router.post("/bulk", requestScope({ location: false }), createBulk)
// Bulk updates (POS offline sync): items[] = [{ id (staff number), ...fields }].
router.patch("/bulk", patchBulk)
router.patch("/bulk/status", patchBulkStatus)
router.patch("/bulk/location", patchBulkLocation)
router.patch("/bulk/password", patchBulkPassword)
router.get("/:id/sales", sales)
router.get("/:id", getOne)
router.patch("/:id", validate(parsePatchStaff), patch)
router.delete("/:id", remove)

export default router
