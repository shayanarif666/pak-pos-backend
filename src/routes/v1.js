import { Router } from "express"
import healthRoutes from "../modules/health/health.routes.js"
import authRoutes from "../modules/auth/auth.routes.js"
import staffRoutes from "../modules/auth/staff.routes.js"
import storeRoutes from "../modules/stores/store.routes.js"
import locationRoutes from "../modules/locations/location.routes.js"
import categoryRoutes from "../modules/catalog/category.routes.js"
import productRoutes from "../modules/catalog/product.routes.js"
import productStockRoutes from "../modules/catalog/productStock.routes.js"
import publicCatalogRoutes from "../modules/catalog/publicCatalog.routes.js"
import planRoutes from "../modules/plans/plan.routes.js"
import adminRoutes from "../modules/admin/admin.routes.js"
import licenseRoutes from "../modules/stores/license.routes.js"
import storeBillingRoutes from "../modules/billings/billing.routes.js"
import bannerRoutes from "../modules/stores/banner.routes.js"
import taxRateRoutes from "../modules/stores/taxRate.routes.js"
import backupRoutes from "../modules/stores/backup.routes.js"
import posDeviceRoutes from "../modules/pos/posDevice.routes.js"
import customerRoutes from "../modules/customers/customer.routes.js"
import supplierRoutes from "../modules/inventory/supplier.routes.js"
import stockMovementRoutes from "../modules/inventory/stock.routes.js"
import stockTransferRoutes from "../modules/inventory/transfer.routes.js"
import offerRoutes from "../modules/offers/offer.routes.js"
import couponRoutes from "../modules/coupons/coupon.routes.js"
import registerSessionRoutes from "../modules/pos/registerSession.routes.js"
import {
  approvalOverrideRoutes,
  approvalRequestRoutes,
} from "../modules/pos/approval.routes.js"
import orderRoutes from "../modules/orders/order.routes.js"
import paymentRoutes from "../modules/payments/payment.routes.js"
import receiptRoutes from "../modules/payments/receipt.routes.js"
import cartRoutes from "../modules/carts/cart.routes.js"
import addressRoutes from "../modules/addresses/address.routes.js"
import reviewRoutes from "../modules/reviews/review.routes.js"
import reportRoutes from "../modules/orders/reports.routes.js"
import auditRoutes from "../modules/audit/audit.routes.js"
import uploadRoutes from "../modules/uploads/upload.routes.js"

const router = Router()

router.use("/health", healthRoutes)
router.use("/auth", authRoutes)
router.use("/staff", staffRoutes)
router.use("/plans", planRoutes)
router.use("/admin", adminRoutes)
router.use("/licenses", licenseRoutes)
router.use("/billings", storeBillingRoutes)
router.use("/stores", storeRoutes)
router.use("/store-banners", bannerRoutes)
router.use("/tax-rates", taxRateRoutes)
router.use("/store-backups", backupRoutes)
router.use("/pos-devices", posDeviceRoutes)
router.use("/locations", locationRoutes)
router.use("/categories", categoryRoutes)
router.use("/products", productRoutes)
router.use("/product-stocks", productStockRoutes)
router.use("/public", publicCatalogRoutes)
router.use("/customers", customerRoutes)
router.use("/suppliers", supplierRoutes)
router.use("/stock-movements", stockMovementRoutes)
router.use("/stock-transfers", stockTransferRoutes)
router.use("/offers", offerRoutes)
router.use("/coupons", couponRoutes)
router.use("/register-sessions", registerSessionRoutes)
router.use("/approval-requests", approvalRequestRoutes)
router.use("/approvals", approvalOverrideRoutes)
router.use("/orders", orderRoutes)
router.use("/payments", paymentRoutes)
router.use("/receipts", receiptRoutes)
router.use("/cart", cartRoutes)
router.use("/addresses", addressRoutes)
router.use("/reviews", reviewRoutes)
router.use("/reports", reportRoutes)
router.use("/audit-logs", auditRoutes)
router.use("/uploads", uploadRoutes)

export default router
