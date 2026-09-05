import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import {
  applyCloudinaryImages,
  uploadImageFields,
} from "../../shared/middlewares/upload.middleware.js"
import {
  parsePatchStore,
  parsePutContent,
  parsePutShipping,
  parsePutTheme,
} from "./store.validation.js"
import {
  getBySlug,
  getContent,
  getMyStore,
  getShipping,
  getTheme,
  patchMyStore,
  putContent,
  putShipping,
  putTheme,
} from "./store.controller.js"

const router = Router()
const tenantStaff = [
  authMiddleware,
  authorize("store_admin", "manager", "cashier"),
  tenantMiddleware,
  requireTenantStore,
]
const managerStore = [
  authMiddleware,
  authorize("store_admin", "manager"),
  tenantMiddleware,
  requireTenantStore,
]

router.get("/by-slug/:slug", getBySlug)
router.get("/me", ...tenantStaff, getMyStore)
router.patch(
  "/me",
  ...managerStore,
  uploadImageFields([
    { name: "logo", maxCount: 1 },
    { name: "favicon", maxCount: 1 },
  ]),
  applyCloudinaryImages([
    { fileField: "logo", bodyField: "logo_url", kind: "logos" },
    { fileField: "favicon", bodyField: "favicon_url", kind: "favicons" },
  ]),
  validate(parsePatchStore),
  patchMyStore
)
router.get("/me/theme", ...managerStore, getTheme)
router.put("/me/theme", ...managerStore, validate(parsePutTheme), putTheme)
router.get("/me/content", ...managerStore, getContent)
router.put("/me/content", ...managerStore, validate(parsePutContent), putContent)
router.get("/me/shipping", ...managerStore, getShipping)
router.put(
  "/me/shipping",
  ...managerStore,
  validate(parsePutShipping),
  putShipping
)

export default router
