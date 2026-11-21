import { Router } from "express"
import { bulkDelete } from "../../shared/utils/bulkDelete.util.js"
import { categoryLists, categoryOne } from "../dashboard/dashboardLists.js"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { requestScope } from "../../shared/middlewares/requestScope.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import {
  applyCloudinaryImages,
  uploadImageFields,
} from "../../shared/middlewares/upload.middleware.js"
import {
  parseCreateCategory,
  parsePatchCategory,
} from "./category.validation.js"
import {
  create,
  createBulk,
  getOne,
  list,
  patch,
  patchBulk,
  patchBulkStatus,
  patchLocations,
  remove,
} from "./category.controller.js"
import { bulkPatch } from "../../shared/middlewares/bulkPatch.middleware.js"

const router = Router()
const tenant = [authMiddleware, tenantMiddleware, requireTenantStore]

// PATCH /bulk takes the body of its POST (storeId, items[] with the POST field names).
const PATCH_BODY = bulkPatch()

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
  requestScope({ location: false }),
  validate(parseCreateCategory),
  create
)
router.post(
  "/bulk",
  ...tenant,
  authorize("store_admin", "manager"),
  requestScope({ location: false }),
  createBulk
)
// Bulk updates (POS offline sync): items[] = [{ id (category number), ...fields }].
router.patch("/bulk", ...tenant, authorize("store_admin", "manager"), ...PATCH_BODY, patchBulk)
router.patch("/bulk/status", ...tenant, authorize("store_admin", "manager"), ...PATCH_BODY, patchBulkStatus)
// Where several categories are sold, in one call (dashboard: select rows -> Update Locations).
router.patch("/locations", ...tenant, authorize("store_admin"), patchLocations)
// Dashboard: the Categories table (Category #, Name, Sold At, Active).
router.get("/lists", ...tenant, authorize("store_admin", "manager", "cashier"), categoryLists)
// One category with where it is sold and its products (the /products/lists columns).
router.get("/:id", ...tenant, authorize("store_admin", "manager", "cashier"), categoryOne)
router.get(
  "/:id/legacy",
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
// The bulk form of the delete below (as POST / PATCH /bulk): { storeId, items: [{ id }] }, each item that delete.
router.delete("/bulk", ...tenant, authorize("store_admin", "manager"), bulkDelete(remove, "Categories Deleted"))
router.delete(
  "/:id",
  ...tenant,
  authorize("store_admin", "manager"),
  remove
)

export default router
