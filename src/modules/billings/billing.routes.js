import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import { parseCreateBilling, parsePatchBilling } from "./billing.validation.js"
import {
  createAdmin,
  listAdmin,
  listMine,
  patchAdmin,
} from "./billing.controller.js"

export const adminBillingRoutes = Router()
adminBillingRoutes.use(authMiddleware, authorize("superadmin"))
adminBillingRoutes.get("/", listAdmin)
adminBillingRoutes.post("/", validate(parseCreateBilling), createAdmin)
adminBillingRoutes.patch("/:id", validate(parsePatchBilling), patchAdmin)

const storeBillingRoutes = Router()
storeBillingRoutes.use(
  authMiddleware,
  authorize("store_admin", "manager"),
  tenantMiddleware,
  requireTenantStore
)
storeBillingRoutes.get("/", listMine)

export default storeBillingRoutes
