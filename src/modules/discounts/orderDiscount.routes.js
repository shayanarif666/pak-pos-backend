import { Router } from "express"
import { bulkDelete } from "../../shared/utils/bulkDelete.util.js"
import { discountLists } from "../dashboard/dashboardLists.js"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import { requireTenantStore, tenantMiddleware } from "../../shared/middlewares/tenant.middleware.js"
import { create, createBulk, getOne, list, patch, patchBulk, remove } from "./orderDiscount.controller.js"

const router = Router()
const tenant = [authMiddleware, tenantMiddleware, requireTenantStore]
const read = [...tenant, authorize("store_admin", "manager", "cashier")]
const write = [...tenant, authorize("store_admin", "manager")]

// The order-level discounts: a name, a type, an amount and whether it goes on every order.
router.get("/", ...read, list)
router.post("/", ...write, create)
router.post("/bulk", ...write, createBulk)
router.patch("/bulk", ...write, patchBulk)
// Dashboard: the Discounts tab — the order, bulk and bundle discounts together.
router.get("/lists", ...read, discountLists)
router.get("/:id", ...read, getOne)
router.patch("/:id", ...write, patch)
// The bulk form of the delete below (as POST / PATCH /bulk): { storeId, items: [{ id }] }, each item that delete.
router.delete("/bulk", ...write, bulkDelete(remove, "Discounts Deleted"))
router.delete("/:id", ...write, remove)

export default router
