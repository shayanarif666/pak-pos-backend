import { Router } from "express"
import { bulkDelete } from "../../shared/utils/bulkDelete.util.js"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import { requestScope } from "../../shared/middlewares/requestScope.middleware.js"
import { requireTenantStore, tenantMiddleware } from "../../shared/middlewares/tenant.middleware.js"
import { bulkPatch } from "../../shared/middlewares/bulkPatch.middleware.js"
import { create, createBulk, getOne, list, patchBulk, patchOne, remove } from "./cashMovement.controller.js"

const router = Router()

// Pay In / Pay Out: the till (any staff role) and the dashboard. A manager / cashier: their own location.
router.use(authMiddleware, authorize("store_admin", "manager", "cashier"), tenantMiddleware, requireTenantStore)

router.get("/", list)
router.post("/", requestScope(), create)
router.post("/bulk", requestScope(), createBulk)
// PATCH /bulk takes the body of its POST (storeId, items[] with the POST field names + id).
router.patch("/bulk", ...bulkPatch(), patchBulk)
router.get("/:id", getOne)
router.patch("/:id", patchOne)
// The bulk form of the delete below (as POST / PATCH /bulk): { storeId, items: [{ id }] }.
router.delete("/bulk", bulkDelete(remove, "Cash Movements Deleted"))
router.delete("/:id", remove)

export default router
