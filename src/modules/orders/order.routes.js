import { Router } from "express"
import { orderLists } from "../dashboard/dashboardLists.js"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { requestScope } from "../../shared/middlewares/requestScope.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import {
  parseAddPayment,
  parseCreateOrder,
  parseRefundComplete,
  parseRefundItem,
  parseVoidCancel,
} from "./order.validation.js"
import {
  addPayment,
  cancel,
  create,
  createBulk,
  getOne,
  list,
  listCancelled,
  listCustom,
  listRefunds,
  salesByLocation,
  listPayments,
  patchBulk,
  patchBulkPaymentMethod,
  patchBulkStatus,
  receipt,
  refundComplete,
  refundCompleteBulk,
  refundItem,
  refundItemsBulk,
  refundReceipt,
  refundReceiptById,
  voidOne,
} from "./order.controller.js"
import { bulkPatch } from "../../shared/middlewares/bulkPatch.middleware.js"

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

// PATCH /bulk takes the body of its POST (storeId, items[] with the POST field names).
const PATCH_BODY = bulkPatch({ listKeys: ["orders"] })

router.post("/", ...place, requestScope(), validate(parseCreateOrder), create)
router.post("/bulk", ...place, requestScope(), createBulk)
// Bulk updates (POS offline sync): items[] = [{ id (order number), ... }].
router.patch("/bulk", ...manage, ...PATCH_BODY, patchBulk)
router.patch("/bulk/status", ...manage, ...PATCH_BODY, patchBulkStatus)
router.patch("/bulk/payment-method", ...cancelled, ...PATCH_BODY, patchBulkPaymentMethod)
router.get("/", ...listRoles, list)
router.get("/custom", ...staff, listCustom)
// Dashboard: the Orders History table (Order #, Date, Cashier, Total Items, Total Amount, Status).
router.get("/lists", ...staff, orderLists)
router.get("/cancelled", ...cancelled, listCancelled)
router.get("/refunds", ...staff, listRefunds)
router.get("/refunds/:refundId/receipt", ...staff, refundReceiptById)
router.get("/summary/locations", ...cancelled, salesByLocation)
router.post("/refunds/bulk", ...manage, requestScope(), refundItemsBulk)
router.post("/refunds/complete/bulk", ...manage, requestScope(), refundCompleteBulk)
router.get("/:id/payments", ...staff, listPayments)
router.post(
  "/:id/payments",
  ...tenant,
  authorize("manager", "cashier"),
  validate(parseAddPayment),
  addPayment
)
router.get("/:id/receipt", ...staff, receipt)
router.post("/:id/refund", ...manage, requestScope(), validate(parseRefundItem), refundItem)
router.post(
  "/:id/refund/complete",
  ...manage,
  requestScope(),
  validate(parseRefundComplete),
  refundComplete
)
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
