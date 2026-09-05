import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { list } from "./audit.controller.js"

const router = Router()
const read = [
  authMiddleware,
  tenantMiddleware,
  requireTenantStore,
  authorize("store_admin", "manager"),
]

router.get("/", ...read, list)

export default router
