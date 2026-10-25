export const PLAN_TYPE = ["monthly", "yearly"]
export const BUSINESS_TYPE = [
  "grocery",
  "boutique",
  "retail",
  "pharmacy",
  "restaurant",
  "cafe",
  "bakery",
  "electronics",
  "fashion",
  "clothing",
  "beauty",
  "furniture",
  "hardware",
  "sports",
  "books",
  "jewelry",
  "supermarket",
  "convenience",
  "wholesale",
  "other",
]
// "trial": a trial store's license — usable like "active" until it expires (3 days).
export const LICENSE_STATUS = ["pending", "trial", "active", "expired", "revoked", "suspended"]
/** License statuses that let the store work (pending = not yet bound to a till). */
export const USABLE_LICENSE_STATUS = ["pending", "trial", "active"]
/** stores.status: on a free trial, or a paid (purchased) plan. */
export const STORE_STATUS = ["trial", "active"]
/** Days a new trial store runs; after it ends the owner has a few more days to decide. */
export const TRIAL_DAYS = 3
export const TRIAL_DECISION_DAYS = 2
/** plans.reporting_level */
export const REPORTING_LEVEL = ["basic", "standard", "advanced", "custom"]
/** staff_sessions.status: staff attendance (clock in / clock out). */
export const STAFF_SESSION_STATUS = ["clock_in", "clock_out"]
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
/** Catalog / CRM / stock rows can exist on both channels at once. */
export const RECORD_CHANNEL = ["web", "pos", "both"]
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
export const PRODUCT_UNIT = [
  "piece",
  "kg",
  "gram",
  "liter",
  "ml",
  "packet",
  "box",
  "dozen",
  "pair",
  "meter",
  "yard",
  "roll",
  "set",
  "carton",
  "bag",
  "bottle",
  "can",
]
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
/** register_sessions (batches = cash drawer): open until the batch is closed. */
export const REGISTER_SESSION_STATUS = ["open", "closed"]
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
export const TRANSFER_STATUS = ["pending", "on_the_way", "completed", "cancelled"]
export const LEDGER_ENTRY_TYPE = ["debit", "credit"]
/** suppliers.location_scope: delivers to every branch, or only to supplier_locations rows. */
export const SUPPLIER_LOCATION_SCOPE = ["all", "selected"]
export const RECORD_SOURCE = ["web", "pos", "sync"]
