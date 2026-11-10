import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import { requireTenantStore, tenantMiddleware } from "../../shared/middlewares/tenant.middleware.js"
import { create, createBulk, getOne, list, patch, patchBulk, remove } from "./bulkDiscount.controller.js"

const router = Router()
const tenant = [authMiddleware, tenantMiddleware, requireTenantStore]
const read = [...tenant, authorize("store_admin", "manager", "cashier")]
const write = [...tenant, authorize("store_admin", "manager")]

/*
 * Bulk discount: buy more of ONE product (or one variant) and every unit gets cheaper, in steps (tiers):
 * 1 unit Rs 70; 10 units Rs 700 less Rs 100 = from 10 units Rs 10 off each unit.
 */
router.get("/", ...read, list)
router.post("/", ...write, create)
router.post("/bulk", ...write, createBulk)
router.patch("/bulk", ...write, patchBulk)
router.get("/:id", ...read, getOne)
router.patch("/:id", ...write, patch)
router.delete("/:id", ...write, remove)

export default router
