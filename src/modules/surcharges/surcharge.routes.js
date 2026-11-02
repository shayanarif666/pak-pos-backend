import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import { requireTenantStore, tenantMiddleware } from "../../shared/middlewares/tenant.middleware.js"
import { create, createBulk, getOne, list, patch, patchBulk, patchBulkStatus, remove } from "./surcharge.controller.js"

const router = Router()
const tenant = [authMiddleware, tenantMiddleware, requireTenantStore]
// Every role reads them (the POS adds them to the bill); only the store admin sets them.
const read = [...tenant, authorize("store_admin", "manager", "cashier")]
const write = [...tenant, authorize("store_admin")]

router.get("/", ...read, list)
router.post("/", ...write, create)
router.post("/bulk", ...write, createBulk)
// Bulk updates: items[] = [{ id (surcharge number or UUID), ...fields }].
router.patch("/bulk", ...write, patchBulk)
router.patch("/bulk/status", ...write, patchBulkStatus)
router.get("/:id", ...read, getOne)
router.patch("/:id", ...write, patch)
router.delete("/:id", ...write, remove)

export default router
