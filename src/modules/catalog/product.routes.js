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
  getImage,
  getOne,
  list,
  listBulkTiers,
  listExpiry,
  listStock,
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
  removeImage,
  removeVariant,
  removeVariantImage,
  uploadImage,
  uploadVariantImage,
} from "./product.controller.js"

const router = Router()
const tenant = [authMiddleware, tenantMiddleware, requireTenantStore]
const catalogRead = [...tenant, authorize("store_admin", "manager", "cashier")]
const catalogWrite = [...tenant, authorize("store_admin", "manager")]

router.get("/", ...catalogRead, list)
// Product image, one per product: multipart image (+ productId: number or UUID).
router.post("/image", ...catalogWrite, uploadSingleImage("image"), uploadImage)
router.post("/:id/image", ...catalogWrite, uploadSingleImage("image"), uploadImage)
router.get("/:id/image", ...catalogRead, getImage)
router.delete("/:id/image", ...catalogWrite, removeImage)
// A variant's own image: multipart image + productId + variantId (its number in the product or UUID).
router.post("/variant-image", ...catalogWrite, uploadSingleImage("image"), uploadVariantImage)
router.post("/:id/variants/:variantId/image", ...catalogWrite, uploadSingleImage("image"), uploadVariantImage)
router.delete("/:id/variants/:variantId/image", ...catalogWrite, removeVariantImage)
// Soft delete of one variant: hidden everywhere, its stock / movements / sales stay.
router.delete("/:id/variants/:variantId", ...catalogWrite, removeVariant)
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
// The stock of every product / variant at every location, with its lots and their expiry.
router.get("/stock", ...catalogRead, listStock)
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
