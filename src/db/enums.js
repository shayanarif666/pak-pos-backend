export const PLAN_CODE = ["package_1", "package_2", "package_3"]
export const BUSINESS_TYPE = ["grocery", "boutique", "retail", "pharmacy"]
export const LICENSE_STATUS = ["pending", "active", "expired", "revoked"]
export const USER_ROLE = [
  "superadmin",
  "store_admin",
  "manager",
  "cashier",
  "customer",
]
export const AUTH_TOKEN_TYPE = ["email_verify", "password_reset"]
export const BILLING_STATUS = ["pending", "paid", "failed", "refunded"]
export const ORDER_CHANNEL = ["web", "pos"]
export const ORDER_STATUS = [
  "pending",
  "completed",
  "voided",
  "cancelled",
  "refunded",
]
export const ORDER_PAYMENT_STATUS = ["pending", "paid", "failed", "refunded"]
export const PAYMENT_METHOD = [
  "cash",
  "card",
  "jazzcash",
  "easypaisa",
  "cod",
  "mixed",
]
export const PAYMENT_ROW_STATUS = ["initiated", "success", "failed"]
export const DISCOUNT_TYPE = ["percentage", "fixed"]
export const TAX_AMOUNT_TYPE = ["percentage", "fixed"]
export const PRODUCT_UNIT = ["piece", "kg", "gram", "liter", "packet", "box"]
export const OFFER_TYPE = ["flash_sale", "bulk_discount", "bogo", "promotional"]
export const OFFER_APPLY_TO = ["product", "category"]
export const STOCK_MOVEMENT_TYPE = [
  "stock_in",
  "stock_out",
  "adjustment",
  "sale",
  "refund",
  "transfer_out",
  "transfer_in",
  "custom_sale",
]
export const STOCK_MOVEMENT_REASON = [
  "purchase",
  "opening_balance",
  "return_to_supplier",
  "customer_return",
  "waste",
  "damage",
  "expiry",
  "theft",
  "count",
  "sale",
  "refund",
  "sync",
  "transfer",
  "custom_sale",
  "other",
]
export const REGISTER_SESSION_STATUS = ["clock_in", "clock_out"]
export const APPROVAL_STATUS = ["pending", "approved", "rejected"]
export const APPROVAL_TYPE = [
  "void_order",
  "cancel_order",
  "pin_override",
  "stock_adjustment",
  "discount_override",
]
export const REVIEW_STATUS = ["pending", "approved", "rejected"]
export const AUDIT_ACTOR_TYPE = ["user", "system"]
export const AUDIT_ACTION = [
  "create",
  "update",
  "delete",
  "login",
  "logout",
  "clock_in",
  "clock_out",
  "sale",
  "void",
  "cancel",
  "refund",
  "pin_override",
  "approve",
  "reject",
  "license_activate",
  "backup",
  "restore",
]
export const TRANSFER_STATUS = ["pending", "completed", "cancelled"]
export const LEDGER_ENTRY_TYPE = ["debit", "credit"]
export const RECORD_SOURCE = ["web", "pos", "sync"]
