import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import {
  parseCreateCoupon,
  parsePatchCoupon,
  parseValidateCoupon,
} from "./coupon.validation.js"
import {
  create,
  getOne,
  list,
  listRedemptions,
  patch,
  validateCoupon,
} from "./coupon.controller.js"

const router = Router()
const tenant = [authMiddleware, tenantMiddleware, requireTenantStore]
const listRoles = [...tenant, authorize("store_admin", "manager", "cashier")]
const write = [...tenant, authorize("store_admin", "manager")]
const preview = [
  ...tenant,
  authorize("store_admin", "manager", "cashier", "customer"),
]

router.get("/", ...listRoles, list)
router.post("/", ...write, validate(parseCreateCoupon), create)
router.post("/validate", ...preview, validate(parseValidateCoupon), validateCoupon)
router.get("/:id/redemptions", ...write, listRedemptions)
router.get("/:id", ...write, getOne)
router.patch("/:id", ...write, validate(parsePatchCoupon), patch)

export default router
