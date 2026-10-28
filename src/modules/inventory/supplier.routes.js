import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
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

const router = Router()

router.use(
  authMiddleware,
  // Cashiers add suppliers too, for their own location (see supplier.service.js).
  authorize("store_admin", "manager", "cashier"),
  tenantMiddleware,
  requireTenantStore
)

router.get("/", list)
router.post("/", validate(parseCreateSupplier), create)
router.post("/bulk", createBulk)
// Bulk update (POS offline sync): items[] = [{ id (supplier number), ...fields }].
router.patch("/bulk", patchBulk)
router.get("/:id", getOne)
router.patch("/:id", validate(parsePatchSupplier), patch)
router.delete("/:id", remove)

export default router
