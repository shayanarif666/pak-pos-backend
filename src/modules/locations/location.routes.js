import { Router } from "express"
import { locationLists, locationOne } from "../dashboard/dashboardLists.js"
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
  deleteLocation,
  getLocation,
  listLocations,
  patchBulk,
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
// Bulk update: items[] = [{ id (location number), ...fields }].
router.patch("/bulk", patchBulk)
// Dashboard: the Locations table (Location #, Name, City, Manager Info, Status) and one location with its staff.
router.get("/lists", locationLists)
router.get("/:id", locationOne)
router.patch("/:id", validate(parsePatchLocation), patchLocation)
// Soft delete a branch (store admin): not the default one, nor with stock or transfers on the way.
router.delete("/:id", authorize("store_admin"), deleteLocation)

export default router
