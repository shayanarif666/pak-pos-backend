import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import {
  parseAddPayment,
  parseCreateOrder,
  parseRefundItem,
  parseVoidCancel,
} from "./order.validation.js"
import {
  addPayment,
  cancel,
  create,
  getOne,
  list,
  listCancelled,
  listCustom,
  listRefunds,
  listPayments,
  receipt,
  refundItem,
  refundReceipt,
  voidOne,
} from "./order.controller.js"

const router = Router()
const tenant = [authMiddleware, tenantMiddleware, requireTenantStore]
const staff = [...tenant, authorize("store_admin", "manager", "cashier")]
const listRoles = [
  ...tenant,
  authorize("store_admin", "manager", "cashier", "customer"),
]
const place = [
  ...tenant,
  authorize("store_admin", "manager", "cashier", "customer"),
]
const manage = [...tenant, authorize("store_admin", "manager", "cashier")]
const cancelled = [...tenant, authorize("store_admin", "manager")]

router.post("/", ...place, validate(parseCreateOrder), create)
router.get("/", ...listRoles, list)
router.get("/custom", ...staff, listCustom)
router.get("/cancelled", ...cancelled, listCancelled)
router.get("/refunds", ...staff, listRefunds)
router.get("/:id/payments", ...staff, listPayments)
router.post(
  "/:id/payments",
  ...tenant,
  authorize("manager", "cashier"),
  validate(parseAddPayment),
  addPayment
)
router.get("/:id/receipt", ...staff, receipt)
router.post("/:id/refund", ...manage, validate(parseRefundItem), refundItem)
router.get("/:id/refunds/:refundId/receipt", ...staff, refundReceipt)
router.post("/:id/void", ...manage, validate(parseVoidCancel), voidOne)
router.post("/:id/cancel", ...manage, validate(parseVoidCancel), cancel)
router.get(
  "/:id",
  ...tenant,
  authorize("store_admin", "manager", "cashier", "customer"),
  getOne
)

export default router
