import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { rateLimit } from "../../shared/middlewares/rateLimit.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import { parseValidateLicense } from "./license.validation.js"
import {
  getByLocation,
  getMine,
  listMine,
  me,
  validate as validateLicense,
} from "./license.controller.js"

const router = Router()

router.post(
  "/validate",
  rateLimit({ max: 20 }),
  validate(parseValidateLicense),
  validateLicense
)

const tenant = [authMiddleware, tenantMiddleware, requireTenantStore]

router.get("/", ...tenant, authorize("store_admin"), listMine)
router.get(
  "/me",
  ...tenant,
  authorize("store_admin", "manager", "cashier"),
  me
)
router.get(
  "/location/:locationId",
  ...tenant,
  authorize("store_admin", "manager"),
  getByLocation
)
router.get("/:id", ...tenant, authorize("store_admin", "manager"), getMine)

export default router
