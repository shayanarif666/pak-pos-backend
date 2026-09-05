import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import {
  parseCreateLocation,
  parsePatchLocation,
} from "./location.validation.js"
import {
  createLocation,
  getLocation,
  listLocations,
  patchLocation,
} from "./location.controller.js"

const router = Router()

router.use(
  authMiddleware,
  authorize("store_admin", "manager"),
  tenantMiddleware,
  requireTenantStore
)

router.get("/", listLocations)
router.post(
  "/",
  authorize("store_admin"),
  validate(parseCreateLocation),
  createLocation
)
router.get("/:id", getLocation)
router.patch("/:id", validate(parsePatchLocation), patchLocation)

export default router
