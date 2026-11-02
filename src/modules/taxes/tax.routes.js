import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import { requireTenantStore, tenantMiddleware } from "../../shared/middlewares/tenant.middleware.js"
import { create, createBulk, getOne, list, patch, patchBulk, patchBulkStatus, remove } from "./tax.controller.js"

const router = Router()
const tenant = [authMiddleware, tenantMiddleware, requireTenantStore]
// Every role reads the taxes (the POS applies them); only the store admin defines them.
const read = [...tenant, authorize("store_admin", "manager", "cashier")]
const write = [...tenant, authorize("store_admin")]

router.get("/", ...read, list)
router.post("/", ...write, create)
router.post("/bulk", ...write, createBulk)
// Bulk updates: items[] = [{ id (tax number or UUID), ...fields }].
router.patch("/bulk", ...write, patchBulk)
router.patch("/bulk/status", ...write, patchBulkStatus)
router.get("/:id", ...read, getOne)
router.patch("/:id", ...write, patch)
router.delete("/:id", ...write, remove)

export default router
