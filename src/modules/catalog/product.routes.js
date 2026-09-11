import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import {
  applyCloudinaryImage,
  uploadSingleImage,
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
  uploadSingleImage("image"),
  applyCloudinaryImage({ fileField: "image", bodyField: "image_url", kind: "products" }),
  validate(parseCreateProduct),
  create
)
router.post("/bulk", ...catalogWrite, createBulk)
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
  uploadSingleImage("image"),
  applyCloudinaryImage({ fileField: "image", bodyField: "image_url", kind: "products" }),
  validate(parsePatchProduct),
  patch
)
router.delete("/:id", ...catalogWrite, remove)

export default router
