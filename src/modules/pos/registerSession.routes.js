import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import { parseCloseBatch, parseOpenBatch } from "./registerSession.validation.js"
import {
  closeBatch,
  current,
  getOne,
  list,
  openBatch,
} from "./registerSession.controller.js"

const router = Router()
const tenant = [authMiddleware, tenantMiddleware, requireTenantStore]
const staff = [...tenant, authorize("store_admin", "manager", "cashier")]
const till = [...tenant, authorize("store_admin", "manager", "cashier")]

router.get("/", ...staff, list)
router.get("/current", ...till, current)
// Batch (cash drawer) opening / closing. Mounted at /batches and, for older clients,
// /register-sessions.
router.post("/open", ...till, validate(parseOpenBatch), openBatch)
router.post("/close", ...till, validate(parseCloseBatch), closeBatch)
router.get("/:id", ...staff, getOne)

export default router
