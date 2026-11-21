import { Router } from "express"
import { bulkDelete } from "../../shared/utils/bulkDelete.util.js"
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
import { bulkPatch } from "../../shared/middlewares/bulkPatch.middleware.js"

const router = Router()

// PATCH /bulk takes the body of its POST (storeId, items[] with the POST field names).
const PATCH_BODY = bulkPatch()

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
router.patch("/bulk", ...PATCH_BODY, patchBulk)
// Dashboard: the Locations table (Location #, Name, City, Manager Info, Status) and one location with its staff.
router.get("/lists", locationLists)
router.get("/:id", locationOne)
router.patch("/:id", validate(parsePatchLocation), patchLocation)
// Soft delete a branch (store admin): not the default one, nor with stock or transfers on the way.
// The bulk form of the delete below (as POST / PATCH /bulk): { storeId, items: [{ id }] }, each item that delete.
router.delete("/bulk", authorize("store_admin"), bulkDelete(deleteLocation, "Locations Deleted"))
router.delete("/:id", authorize("store_admin"), deleteLocation)

export default router
