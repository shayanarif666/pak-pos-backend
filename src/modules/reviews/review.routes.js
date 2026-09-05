import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import { parseCreateReview, parseModerateReview } from "./review.validation.js"
import { create, list, moderate } from "./review.controller.js"

const router = Router()
const tenant = [authMiddleware, tenantMiddleware, requireTenantStore]

router.post(
  "/",
  ...tenant,
  authorize("customer"),
  validate(parseCreateReview),
  create
)
router.get("/", ...tenant, authorize("store_admin", "manager"), list)
router.patch(
  "/:id",
  ...tenant,
  authorize("store_admin", "manager"),
  validate(parseModerateReview),
  moderate
)

export default router
