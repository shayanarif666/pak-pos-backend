import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import {
  parseCreateApproval,
  parsePinOverride,
  parseReviewApproval,
} from "./approval.validation.js"
import { create, list, override, review } from "./approval.controller.js"

const tenant = [authMiddleware, tenantMiddleware, requireTenantStore]

export const approvalRequestRoutes = Router()
approvalRequestRoutes.post(
  "/",
  ...tenant,
  authorize("cashier"),
  validate(parseCreateApproval),
  create
)
approvalRequestRoutes.get(
  "/",
  ...tenant,
  authorize("store_admin", "manager"),
  list
)
approvalRequestRoutes.patch(
  "/:id",
  ...tenant,
  authorize("store_admin", "manager"),
  validate(parseReviewApproval),
  review
)

export const approvalOverrideRoutes = Router()
approvalOverrideRoutes.post(
  "/pin-override",
  ...tenant,
  authorize("store_admin", "manager"),
  validate(parsePinOverride),
  override
)
