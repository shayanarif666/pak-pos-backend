import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import { parsePutStock } from "./productStock.validation.js"
import { getOne, list, listLow, put } from "./productStock.controller.js"

const router = Router()
const tenant = [authMiddleware, tenantMiddleware, requireTenantStore]
const read = [...tenant, authorize("store_admin", "manager", "cashier")]
const write = [...tenant, authorize("store_admin", "manager")]

router.get("/", ...read, list)
router.get("/low", ...read, listLow)
router.put("/:productId", ...write, validate(parsePutStock), put)
router.get("/:id", ...write, getOne)

export default router
