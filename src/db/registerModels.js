import { Plan } from "../modules/plans/plan.model.js"
import { Store } from "../modules/stores/store.model.js"
import { StoreTheme } from "../modules/stores/storeTheme.model.js"
import { WebsiteContent } from "../modules/stores/websiteContent.model.js"
import { ShippingRule } from "../modules/stores/shippingRule.model.js"
import { StoreLicense } from "../modules/stores/storeLicense.model.js"
import { StoreBanner } from "../modules/stores/storeBanner.model.js"
import { PaymentMethodTaxRate } from "../modules/stores/paymentMethodTaxRate.model.js"
import { StoreBackup } from "../modules/stores/storeBackup.model.js"
import { Location } from "../modules/locations/location.model.js"
import { User } from "../modules/auth/user.model.js"
import { AuthToken } from "../modules/auth/authToken.model.js"
import { Billing } from "../modules/billings/billing.model.js"
import { PosDevice } from "../modules/pos/posDevice.model.js"
import { RegisterSession } from "../modules/pos/registerSession.model.js"
import { ApprovalRequest } from "../modules/pos/approvalRequest.model.js"
import { Category } from "../modules/catalog/category.model.js"
import { Product } from "../modules/catalog/product.model.js"
import { ProductStock } from "../modules/catalog/productStock.model.js"
import { ProductBulkTier } from "../modules/catalog/productBulkTier.model.js"
import { Supplier } from "../modules/inventory/supplier.model.js"
import { SupplierLedger } from "../modules/inventory/supplierLedger.model.js"
import { StockMovement } from "../modules/inventory/stockMovement.model.js"
import { StockTransfer } from "../modules/inventory/stockTransfer.model.js"
import { Customer } from "../modules/customers/customer.model.js"
import { CustomerCreditEntry } from "../modules/customers/customerCreditEntry.model.js"
import { Cart } from "../modules/carts/cart.model.js"
import { CartItem } from "../modules/carts/cartItem.model.js"
import { Address } from "../modules/addresses/address.model.js"
import { Offer } from "../modules/offers/offer.model.js"
import { OfferTarget } from "../modules/offers/offerTarget.model.js"
import { Coupon } from "../modules/coupons/coupon.model.js"
import { CouponRedemption } from "../modules/coupons/couponRedemption.model.js"
import { Order } from "../modules/orders/order.model.js"
import { OrderItem } from "../modules/orders/orderItem.model.js"
import { OrderRefund } from "../modules/orders/orderRefund.model.js"
import { OrderRefundItem } from "../modules/orders/orderRefundItem.model.js"
import { Receipt } from "../modules/payments/receipt.model.js"
import { Payment } from "../modules/payments/payment.model.js"
import { Review } from "../modules/reviews/review.model.js"
import { AuditLog } from "../modules/audit/auditLog.model.js"
import { Counter } from "../shared/utils/counter.model.js"

let associated = false

export function registerModels() {
  if (associated) return
  associated = true

  Store.belongsTo(Plan, { foreignKey: "plan_id" })
  Plan.hasMany(Store, { foreignKey: "plan_id" })

  Store.belongsTo(User, { foreignKey: "admin_id", as: "admin" })
  User.hasOne(Store, { foreignKey: "admin_id", as: "administeredStore" })

  Store.hasMany(Location, { foreignKey: "store_id" })
  Location.belongsTo(Store, { foreignKey: "store_id" })
  Store.belongsTo(Location, { foreignKey: "default_location_id", as: "defaultLocation" })

  Store.hasOne(StoreTheme, { foreignKey: "store_id" })
  StoreTheme.belongsTo(Store, { foreignKey: "store_id" })

  Store.hasOne(WebsiteContent, { foreignKey: "store_id" })
  WebsiteContent.belongsTo(Store, { foreignKey: "store_id" })

  Store.hasOne(ShippingRule, { foreignKey: "store_id" })
  ShippingRule.belongsTo(Store, { foreignKey: "store_id" })

  Store.hasMany(StoreBanner, { foreignKey: "store_id" })
  StoreBanner.belongsTo(Store, { foreignKey: "store_id" })

  Store.hasMany(PaymentMethodTaxRate, { foreignKey: "store_id" })
  PaymentMethodTaxRate.belongsTo(Store, { foreignKey: "store_id" })

  Store.hasMany(StoreLicense, { foreignKey: "store_id" })
  StoreLicense.belongsTo(Store, { foreignKey: "store_id" })
  StoreLicense.belongsTo(Plan, { foreignKey: "plan_id" })
  StoreLicense.belongsTo(PosDevice, { foreignKey: "device_id", as: "device" })
  PosDevice.hasOne(StoreLicense, { foreignKey: "device_id", as: "license" })

  Store.hasMany(StoreBackup, { foreignKey: "store_id" })
  StoreBackup.belongsTo(Store, { foreignKey: "store_id" })
  StoreBackup.belongsTo(User, { foreignKey: "created_by", as: "createdBy" })

  Store.hasMany(Billing, { foreignKey: "store_id" })
  Billing.belongsTo(Store, { foreignKey: "store_id" })
  Billing.belongsTo(Plan, { foreignKey: "plan_id" })
  Billing.belongsTo(User, { foreignKey: "created_by", as: "createdBy" })

  User.belongsTo(Store, { foreignKey: "store_id", as: "store" })
  Store.hasMany(User, { foreignKey: "store_id", as: "users" })
  User.belongsTo(Location, { foreignKey: "location_id" })
  User.hasMany(AuthToken, { foreignKey: "user_id" })
  AuthToken.belongsTo(User, { foreignKey: "user_id" })

  PosDevice.belongsTo(Store, { foreignKey: "store_id" })
  PosDevice.belongsTo(Location, { foreignKey: "location_id" })

  RegisterSession.belongsTo(Store, { foreignKey: "store_id" })
  RegisterSession.belongsTo(Location, { foreignKey: "location_id" })
  RegisterSession.belongsTo(User, { foreignKey: "cashier_id", as: "cashier" })
  RegisterSession.belongsTo(PosDevice, { foreignKey: "device_id", as: "device" })

  ApprovalRequest.belongsTo(Store, { foreignKey: "store_id" })
  ApprovalRequest.belongsTo(Location, { foreignKey: "location_id" })
  ApprovalRequest.belongsTo(User, { foreignKey: "requested_by", as: "requester" })
  ApprovalRequest.belongsTo(User, { foreignKey: "reviewed_by", as: "reviewer" })
  ApprovalRequest.belongsTo(Order, { foreignKey: "order_id" })

  Category.belongsTo(Store, { foreignKey: "store_id" })
  Category.belongsTo(Category, { foreignKey: "parent_category_id", as: "parent" })

  Product.belongsTo(Store, { foreignKey: "store_id" })
  Product.belongsTo(Category, { foreignKey: "category_id" })
  Category.hasMany(Product, { foreignKey: "category_id" })

  Product.hasMany(ProductStock, { foreignKey: "product_id" })
  ProductStock.belongsTo(Product, { foreignKey: "product_id" })
  ProductStock.belongsTo(Store, { foreignKey: "store_id" })
  ProductStock.belongsTo(Location, { foreignKey: "location_id" })

  Product.hasMany(ProductBulkTier, { foreignKey: "product_id" })
  ProductBulkTier.belongsTo(Product, { foreignKey: "product_id" })
  ProductBulkTier.belongsTo(Store, { foreignKey: "store_id" })

  Supplier.belongsTo(Store, { foreignKey: "store_id" })
  Supplier.hasMany(SupplierLedger, { foreignKey: "supplier_id" })
  SupplierLedger.belongsTo(Supplier, { foreignKey: "supplier_id" })
  SupplierLedger.belongsTo(Store, { foreignKey: "store_id" })
  SupplierLedger.belongsTo(Location, { foreignKey: "location_id" })
  SupplierLedger.belongsTo(User, { foreignKey: "created_by", as: "createdBy" })
  SupplierLedger.belongsTo(StockMovement, { foreignKey: "stock_movement_id" })

  Customer.belongsTo(Store, { foreignKey: "store_id" })
  Customer.belongsTo(Location, { foreignKey: "location_id" })
  Customer.belongsTo(User, { foreignKey: "user_id" })
  Customer.hasMany(CustomerCreditEntry, { foreignKey: "customer_id" })
  CustomerCreditEntry.belongsTo(Customer, { foreignKey: "customer_id" })
  CustomerCreditEntry.belongsTo(Store, { foreignKey: "store_id" })
  CustomerCreditEntry.belongsTo(Order, { foreignKey: "order_id" })
  CustomerCreditEntry.belongsTo(User, { foreignKey: "created_by", as: "createdBy" })

  Order.belongsTo(Store, { foreignKey: "store_id" })
  Order.belongsTo(Location, { foreignKey: "location_id" })
  Order.belongsTo(User, { foreignKey: "cashier_id", as: "cashier" })
  Order.belongsTo(Customer, { foreignKey: "customer_id", as: "customer" })
  Order.belongsTo(RegisterSession, { foreignKey: "register_session_id" })
  Order.belongsTo(Coupon, { foreignKey: "coupon_id" })
  Order.belongsTo(User, { foreignKey: "voided_by", as: "voidedBy" })
  Order.belongsTo(User, { foreignKey: "cancelled_by", as: "cancelledBy" })
  Order.hasMany(OrderItem, { foreignKey: "order_id" })
  OrderItem.belongsTo(Order, { foreignKey: "order_id" })
  OrderItem.belongsTo(Product, { foreignKey: "product_id" })
  Order.hasMany(OrderRefund, { foreignKey: "order_id" })
  OrderRefund.belongsTo(Order, { foreignKey: "order_id" })
  OrderRefund.belongsTo(User, { foreignKey: "cashier_id", as: "cashier" })
  OrderRefund.belongsTo(Receipt, { foreignKey: "receipt_id" })
  OrderRefund.hasMany(OrderRefundItem, { foreignKey: "refund_id" })
  OrderRefundItem.belongsTo(OrderRefund, { foreignKey: "refund_id" })
  OrderRefundItem.belongsTo(OrderItem, { foreignKey: "order_item_id" })

  Receipt.belongsTo(Store, { foreignKey: "store_id" })
  Receipt.belongsTo(Location, { foreignKey: "location_id" })
  Receipt.belongsTo(Order, { foreignKey: "order_id" })
  Receipt.belongsTo(Payment, { foreignKey: "payment_id" })
  Receipt.belongsTo(User, { foreignKey: "cashier_id", as: "cashier" })

  Payment.belongsTo(Store, { foreignKey: "store_id" })
  Payment.belongsTo(Location, { foreignKey: "location_id" })
  Payment.belongsTo(Order, { foreignKey: "order_id" })
  Order.hasMany(Payment, { foreignKey: "order_id" })

  Coupon.belongsTo(Store, { foreignKey: "store_id" })
  Coupon.belongsTo(Location, { foreignKey: "location_id" })
  Coupon.hasMany(CouponRedemption, { foreignKey: "coupon_id" })
  CouponRedemption.belongsTo(Coupon, { foreignKey: "coupon_id" })
  CouponRedemption.belongsTo(Order, { foreignKey: "order_id" })
  CouponRedemption.belongsTo(User, { foreignKey: "user_id" })
  CouponRedemption.belongsTo(Store, { foreignKey: "store_id" })

  Offer.belongsTo(Store, { foreignKey: "store_id" })
  Offer.belongsTo(Location, { foreignKey: "location_id" })
  Offer.belongsTo(User, { foreignKey: "created_by", as: "createdBy" })
  Offer.hasMany(OfferTarget, { foreignKey: "offer_id" })
  OfferTarget.belongsTo(Offer, { foreignKey: "offer_id" })
  OfferTarget.belongsTo(Product, { foreignKey: "product_id", as: "product" })
  OfferTarget.belongsTo(Category, { foreignKey: "category_id" })
  OfferTarget.belongsTo(Product, { foreignKey: "free_product_id", as: "freeProduct" })

  Cart.belongsTo(Store, { foreignKey: "store_id" })
  Cart.belongsTo(User, { foreignKey: "user_id" })
  Cart.hasMany(CartItem, { foreignKey: "cart_id" })
  CartItem.belongsTo(Cart, { foreignKey: "cart_id" })
  CartItem.belongsTo(Product, { foreignKey: "product_id" })

  Address.belongsTo(Store, { foreignKey: "store_id" })
  Address.belongsTo(User, { foreignKey: "user_id" })

  Review.belongsTo(Store, { foreignKey: "store_id" })
  Review.belongsTo(Product, { foreignKey: "product_id" })
  Review.belongsTo(User, { foreignKey: "user_id" })
  Review.belongsTo(User, { foreignKey: "reviewed_by", as: "reviewer" })

  StockMovement.belongsTo(Store, { foreignKey: "store_id" })
  StockMovement.belongsTo(Location, { foreignKey: "location_id" })
  StockMovement.belongsTo(Product, { foreignKey: "product_id" })
  StockMovement.belongsTo(Supplier, { foreignKey: "supplier_id" })
  StockMovement.belongsTo(User, { foreignKey: "staff_id", as: "staff" })
  StockMovement.belongsTo(Order, { foreignKey: "order_id" })

  StockTransfer.belongsTo(Store, { foreignKey: "store_id" })
  StockTransfer.belongsTo(Location, { foreignKey: "from_location_id", as: "fromLocation" })
  StockTransfer.belongsTo(Location, { foreignKey: "to_location_id", as: "toLocation" })
  StockTransfer.belongsTo(Product, { foreignKey: "product_id" })
  StockTransfer.belongsTo(User, { foreignKey: "created_by", as: "createdBy" })

  AuditLog.belongsTo(Store, { foreignKey: "store_id" })
  AuditLog.belongsTo(Location, { foreignKey: "location_id" })
  AuditLog.belongsTo(User, { foreignKey: "user_id" })
  AuditLog.belongsTo(PosDevice, { foreignKey: "device_id" })

  void Counter
}

export {
  Plan,
  Store,
  StoreTheme,
  WebsiteContent,
  ShippingRule,
  StoreLicense,
  StoreBanner,
  PaymentMethodTaxRate,
  StoreBackup,
  Location,
  User,
  AuthToken,
  Billing,
  PosDevice,
  RegisterSession,
  ApprovalRequest,
  Category,
  Product,
  ProductStock,
  ProductBulkTier,
  Supplier,
  SupplierLedger,
  StockMovement,
  StockTransfer,
  Customer,
  CustomerCreditEntry,
  Cart,
  CartItem,
  Address,
  Offer,
  OfferTarget,
  Coupon,
  CouponRedemption,
  Order,
  OrderItem,
  OrderRefund,
  OrderRefundItem,
  Receipt,
  Payment,
  Review,
  AuditLog,
  Counter,
}
