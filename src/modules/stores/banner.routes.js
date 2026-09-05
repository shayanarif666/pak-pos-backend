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
import { parseCreateBanner, parsePatchBanner } from "./banner.validation.js"
import { create, list, patch, remove } from "./banner.controller.js"

const router = Router()

router.use(
  authMiddleware,
  authorize("store_admin", "manager"),
  tenantMiddleware,
  requireTenantStore
)

router.get("/", list)
router.post(
  "/",
  uploadSingleImage("image"),
  applyCloudinaryImage({ fileField: "image", bodyField: "image_url", kind: "banners" }),
  validate(parseCreateBanner),
  create
)
router.patch(
  "/:id",
  uploadSingleImage("image"),
  applyCloudinaryImage({ fileField: "image", bodyField: "image_url", kind: "banners" }),
  validate(parsePatchBanner),
  patch
)
router.delete("/:id", remove)

export default router
