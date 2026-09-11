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
  parseCreateCategory,
  parsePatchCategory,
} from "./category.validation.js"
import { create, createBulk, getOne, list, patch, remove } from "./category.controller.js"

const router = Router()
const tenant = [authMiddleware, tenantMiddleware, requireTenantStore]

router.get(
  "/",
  ...tenant,
  authorize("store_admin", "manager", "cashier"),
  list
)
const categoryImages = [
  uploadImageFields([
    { name: "image", maxCount: 1 },
    { name: "icon", maxCount: 1 },
  ]),
  applyCloudinaryImages([
    { fileField: "image", bodyField: "image_url", kind: "categories" },
    { fileField: "icon", bodyField: "image_url", kind: "categories" },
  ]),
]

router.post(
  "/",
  ...tenant,
  authorize("store_admin", "manager"),
  ...categoryImages,
  validate(parseCreateCategory),
  create
)
router.post(
  "/bulk",
  ...tenant,
  authorize("store_admin", "manager"),
  createBulk
)
router.get(
  "/:id",
  ...tenant,
  authorize("store_admin", "manager", "cashier"),
  getOne
)
router.patch(
  "/:id",
  ...tenant,
  authorize("store_admin", "manager"),
  ...categoryImages,
  validate(parsePatchCategory),
  patch
)
router.delete(
  "/:id",
  ...tenant,
  authorize("store_admin", "manager"),
  remove
)

export default router
