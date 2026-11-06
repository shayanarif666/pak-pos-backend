import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import { parsePutStock } from "./productStock.validation.js"
import { getOne, list, listLow, patchBulk, patchBulkQty, put, removeEntry } from "./productStock.controller.js"

const router = Router()
const tenant = [authMiddleware, tenantMiddleware, requireTenantStore]
const read = [...tenant, authorize("store_admin", "manager", "cashier")]
const write = [...tenant, authorize("store_admin", "manager")]

router.get("/", ...read, list)
router.get("/low", ...read, listLow)
// Stock edits, one item or many (POS offline sync and Product Stock & Expiry):
// { locationId?, items: [{ product_id, variant_id?, location_id?, qty | number_of_packs..., ... }] }.
router.patch("/bulk", ...write, patchBulk)
router.patch("/bulk/qty", ...write, patchBulkQty)
router.put("/:productId", ...write, validate(parsePutStock), put)
router.get("/:id", ...write, getOne)
// Soft delete one stock entry (a product at a location) from Product Stock & Expiry.
router.delete("/:id", ...write, removeEntry)

export default router
