import { Router } from "express"
import { bulkDelete } from "../../shared/utils/bulkDelete.util.js"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import { requireTenantStore, tenantMiddleware } from "../../shared/middlewares/tenant.middleware.js"
import { create, createBulk, getOne, list, patch, patchBulk, patchBulkStatus, remove } from "./surcharge.controller.js"
import { bulkPatch } from "../../shared/middlewares/bulkPatch.middleware.js"

const router = Router()
const tenant = [authMiddleware, tenantMiddleware, requireTenantStore]
// Every role reads them (the POS adds them to the bill); only the store admin sets them.
const read = [...tenant, authorize("store_admin", "manager", "cashier")]
const write = [...tenant, authorize("store_admin")]

// PATCH /bulk takes the body of its POST (storeId, items[] with the POST field names).
const PATCH_BODY = bulkPatch()

router.get("/", ...read, list)
router.post("/", ...write, create)
router.post("/bulk", ...write, createBulk)
// Bulk updates: items[] = [{ id (surcharge number or UUID), ...fields }].
router.patch("/bulk", ...write, ...PATCH_BODY, patchBulk)
router.patch("/bulk/status", ...write, ...PATCH_BODY, patchBulkStatus)
router.get("/:id", ...read, getOne)
router.patch("/:id", ...write, patch)
// The bulk form of the delete below (as POST / PATCH /bulk): { storeId, items: [{ id }] }, each item that delete.
router.delete("/bulk", ...write, bulkDelete(remove, "Payment Surcharges Deleted"))
router.delete("/:id", ...write, remove)

export default router
