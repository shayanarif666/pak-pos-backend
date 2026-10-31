import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { requestScope } from "../../shared/middlewares/requestScope.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import {
  applyProductImages,
  uploadProductImages,
} from "../../shared/middlewares/upload.middleware.js"
import {
  parseBulkTiers,
  parseCreateProduct,
  parsePatchProduct,
  parseWeightPatch,
} from "./product.validation.js"
import {
  create,
  createBulk,
  getOne,
  list,
  listBulkTiers,
  listExpiry,
  listWeight,
  patch,
  patchBulk,
  patchBulkPrice,
  patchBulkStatus,
  patchBulkVisibility,
  patchBulkWeight,
  patchWeight,
  putBulkTiers,
  remove,
} from "./product.controller.js"

const router = Router()
const tenant = [authMiddleware, tenantMiddleware, requireTenantStore]
const catalogRead = [...tenant, authorize("store_admin", "manager", "cashier")]
const catalogWrite = [...tenant, authorize("store_admin", "manager")]

router.get("/", ...catalogRead, list)
router.post(
  "/",
  ...catalogWrite,
  uploadProductImages(),
  applyProductImages({ kind: "products" }),
  requestScope({ location: false }),
  validate(parseCreateProduct),
  create
)
router.post("/bulk", ...catalogWrite, requestScope({ location: false }), createBulk)
// Bulk updates (POS offline sync): items[] = [{ id (product number), ...fields }].
router.patch("/bulk", ...catalogWrite, patchBulk)
router.patch("/bulk/weight", ...catalogWrite, patchBulkWeight)
router.patch("/bulk/price", ...catalogWrite, patchBulkPrice)
router.patch("/bulk/status", ...catalogWrite, patchBulkStatus)
router.patch("/bulk/visibility", ...catalogWrite, patchBulkVisibility)
router.get("/weight", ...catalogWrite, listWeight)
router.get("/expiry", ...catalogWrite, listExpiry)
router.get("/:id/bulk-tiers", ...catalogRead, listBulkTiers)
router.put(
  "/:id/bulk-tiers",
  ...catalogWrite,
  validate(parseBulkTiers),
  putBulkTiers
)
router.patch(
  "/:id/weight",
  ...catalogWrite,
  validate(parseWeightPatch),
  patchWeight
)
router.get("/:id", ...catalogRead, getOne)
router.patch(
  "/:id",
  ...catalogWrite,
  uploadProductImages(),
  applyProductImages({ kind: "products" }),
  validate(parsePatchProduct),
  patch
)
router.delete("/:id", ...catalogWrite, remove)

export default router
