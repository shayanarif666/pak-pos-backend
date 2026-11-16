import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { requestScope } from "../../shared/middlewares/requestScope.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import { parseCreateSupplier, parsePatchSupplier } from "./supplier.validation.js"
import {
  create,
  createBulk,
  getOne,
  list,
  patch,
  patchBulk,
  remove,
} from "./supplier.controller.js"
import { bulkPatch } from "../../shared/middlewares/bulkPatch.middleware.js"

const router = Router()

// PATCH /bulk takes the body of its POST (storeId, items[] with the POST field names).
const PATCH_BODY = bulkPatch()

router.use(
  authMiddleware,
  // Cashiers add suppliers too, for their own location (see supplier.service.js).
  authorize("store_admin", "manager", "cashier"),
  tenantMiddleware,
  requireTenantStore
)

router.get("/", list)
router.post("/", requestScope({ location: false }), validate(parseCreateSupplier), create)
router.post("/bulk", requestScope({ location: false }), createBulk)
// Bulk update (POS offline sync): items[] = [{ id (supplier number), ...fields }].
router.patch("/bulk", ...PATCH_BODY, patchBulk)
router.get("/:id", getOne)
router.patch("/:id", validate(parsePatchSupplier), patch)
router.delete("/:id", remove)

export default router
