# Database models

Every table of the POS backend with each of its columns, generated from the Sequelize models in
`src/modules/**/*.model.js` (46 tables). Notes come from the comments in those files.

Conventions used across tables:
- **id** — UUID primary key (CHAR(36)).
- **\*_number** — short per-store (or per-parent) sequence 1, 2, 3… shown to the POS instead of the UUID
  (order_number, product_number, user_number…).
- **store_id / store_id_int, location_id / location_id_int** — the store / location UUID and its short number.
- **is_pos_visible, is_web_visible, channel** — where a record is shown / was made (pos | web | both).
- **created_at / updated_at** — added automatically on tables with timestamps.

## Tables

- [addresses](#addresses) — Address
- [approval_requests](#approval_requests) — ApprovalRequest
- [audit_logs](#audit_logs) — AuditLog
- [auth_tokens](#auth_tokens) — AuthToken
- [billings](#billings) — Billing
- [cart_items](#cart_items) — CartItem
- [carts](#carts) — Cart
- [categories](#categories) — Category
- [counters](#counters) — Counter
- [coupon_redemptions](#coupon_redemptions) — CouponRedemption
- [coupons](#coupons) — Coupon
- [currencies](#currencies) — Currency
- [customer_credit_entries](#customer_credit_entries) — CustomerCreditEntry
- [customers](#customers) — Customer
- [locations](#locations) — Location
- [offer_locations](#offer_locations) — OfferLocation
- [offer_targets](#offer_targets) — OfferTarget
- [offers](#offers) — Offer
- [order_items](#order_items) — OrderItem
- [order_refund_items](#order_refund_items) — OrderRefundItem
- [order_refunds](#order_refunds) — OrderRefund
- [orders](#orders) — Order
- [payment_method_tax_rates](#payment_method_tax_rates) — PaymentMethodTaxRate
- [payments](#payments) — Payment
- [plans](#plans) — Plan
- [pos_devices](#pos_devices) — PosDevice
- [product_bulk_tiers](#product_bulk_tiers) — ProductBulkTier
- [product_stocks](#product_stocks) — ProductStock
- [products](#products) — Product
- [receipts](#receipts) — Receipt
- [register_sessions](#register_sessions) — RegisterSession
- [reviews](#reviews) — Review
- [shipping_rules](#shipping_rules) — ShippingRule
- [staff_sessions](#staff_sessions) — StaffSession
- [stock_movements](#stock_movements) — StockMovement
- [stock_transfers](#stock_transfers) — StockTransfer
- [store_backups](#store_backups) — StoreBackup
- [store_banners](#store_banners) — StoreBanner
- [store_licenses](#store_licenses) — StoreLicense
- [store_themes](#store_themes) — StoreTheme
- [stores](#stores) — Store
- [supplier_ledger](#supplier_ledger) — SupplierLedger
- [supplier_locations](#supplier_locations) — SupplierLocation
- [suppliers](#suppliers) — Supplier
- [users](#users) — User
- [website_content](#website_content) — WebsiteContent

---

## addresses

**Model:** `Address` · **File:** `src/modules/addresses/address.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `user_id` | CHAR(36) | NO |  | FK → users.id | User (staff member / customer) |
| `name` | TEXT | NO |  |  | Name |
| `phone` | VARCHAR(64) | NO |  |  |  |
| `address_line` | TEXT | NO |  |  |  |
| `city` | TEXT | NO |  |  |  |
| `postal_code` | VARCHAR(32) | YES |  |  |  |
| `is_default` | TINYINT(1) | NO | false |  |  |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Relations**

- BelongsTo `stores` via `store_id`
- BelongsTo `users` via `user_id`

---

## approval_requests

**Model:** `ApprovalRequest` · **File:** `src/modules/pos/approvalRequest.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `location_id` | CHAR(36) | NO |  | FK → locations.id | Location (branch) this row belongs to |
| `type` | ENUM('void_order', 'cancel_order', 'pin_override', 'stock_adjustment', 'discount_override') | NO |  |  |  |
| `status` | ENUM('pending', 'approved', 'rejected') | NO | pending |  | Current state (see the enum values) |
| `requested_by` | CHAR(36) | NO |  | FK → users.id |  |
| `reviewed_by` | CHAR(36) | YES |  | FK → users.id |  |
| `order_id` | CHAR(36) | YES |  | FK → orders.id | Order |
| `payload` | JSON | YES |  |  |  |
| `reason` | TEXT | YES |  |  | Reason |
| `review_note` | TEXT | YES |  |  |  |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Relations**

- BelongsTo `stores` via `store_id`
- BelongsTo `locations` via `location_id`
- BelongsTo `users` via `requested_by` (as `requester`)
- BelongsTo `users` via `reviewed_by` (as `reviewer`)
- BelongsTo `orders` via `order_id`

---

## audit_logs

**Model:** `AuditLog` · **File:** `src/modules/audit/auditLog.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | YES |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | YES |  |  | Store number (short id) |
| `location_id` | CHAR(36) | YES |  | FK → locations.id | Location (branch) this row belongs to |
| `location_id_int` | INTEGER | YES |  |  | Location number (short id) |
| `device_id` | CHAR(36) | YES |  | FK → pos_devices.id | POS device (till) |
| `actor_type` | ENUM('user', 'system') | NO |  |  |  |
| `user_id` | CHAR(36) | YES |  | FK → users.id | User (staff member / customer) |
| `action` | ENUM('create', 'update', 'delete', 'login', 'logout', 'clock_in', 'clock_out', 'sale', 'void', 'cancel', 'refund', 'pin_override', 'approve', 'reject', 'license_activate', 'backup', 'restore') | NO |  |  |  |
| `entity_type` | TEXT | NO |  |  |  |
| `entity_id` | CHAR(36) | YES |  |  |  |
| `before_data` | JSON | YES |  |  |  |
| `after_data` | JSON | YES |  |  |  |
| `channel` | VARCHAR(32) | YES |  |  | Where it belongs / was made: web, pos (or both) |
| `ip_address` | VARCHAR(64) | YES |  |  |  |
| `user_agent` | TEXT | YES |  |  |  |
| `note` | TEXT | YES |  |  | Free-text note |
| `created_at` | DATETIME | NO |  |  | When the row was created |

**Indexes**

- (store_id, created_at)
- (store_id, entity_type, entity_id)

**Relations**

- BelongsTo `stores` via `store_id`
- BelongsTo `locations` via `location_id`
- BelongsTo `users` via `user_id`
- BelongsTo `pos_devices` via `device_id`

---

## auth_tokens

**Model:** `AuthToken` · **File:** `src/modules/auth/authToken.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `user_id` | CHAR(36) | NO |  | FK → users.id | User (staff member / customer) |
| `type` | ENUM('email_verify', 'password_reset') | NO |  |  |  |
| `token_hash` | TEXT | NO |  |  |  |
| `expires_at` | DATETIME | NO |  |  |  |
| `used_at` | DATETIME | YES |  |  |  |
| `created_at` | DATETIME | NO |  |  | When the row was created |

**Relations**

- BelongsTo `users` via `user_id`

---

## billings

**Model:** `Billing` · **File:** `src/modules/billings/billing.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `plan_id` | CHAR(36) | NO |  | FK → plans.id | Plan |
| `amount` | DECIMAL(12,2) | NO |  |  |  |
| `currency` | VARCHAR(16) | NO | PKR |  |  |
| `status` | ENUM('pending', 'paid', 'failed', 'refunded') | NO | pending |  | Current state (see the enum values) |
| `period_start` | DATETIME | NO |  |  |  |
| `period_end` | DATETIME | NO |  |  |  |
| `paid_at` | DATETIME | YES |  |  |  |
| `method_note` | VARCHAR(255) | YES |  |  |  |
| `note` | TEXT | YES |  |  | Free-text note |
| `created_by` | CHAR(36) | YES |  | FK → users.id | User who created it |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Relations**

- BelongsTo `stores` via `store_id`
- BelongsTo `plans` via `plan_id`
- BelongsTo `users` via `created_by` (as `createdBy`)

---

## cart_items

**Model:** `CartItem` · **File:** `src/modules/carts/cartItem.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `cart_id` | CHAR(36) | NO |  | FK → carts.id |  |
| `product_id` | CHAR(36) | NO |  | FK → products.id | Product |
| `quantity` | DECIMAL(12,4) | NO | 1 |  |  |
| `weight` | DECIMAL(12,4) | YES |  |  |  |

**Indexes**

- UNIQUE (cart_id, product_id)

**Relations**

- BelongsTo `carts` via `cart_id`
- BelongsTo `products` via `product_id`

---

## carts

**Model:** `Cart` · **File:** `src/modules/carts/cart.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `user_id` | CHAR(36) | NO |  | FK → users.id | User (staff member / customer) |
| `coupon_code` | VARCHAR(64) | YES |  |  |  |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (store_id, user_id)

**Relations**

- BelongsTo `stores` via `store_id`
- BelongsTo `users` via `user_id`
- HasMany `cart_items` via `cart_id`

---

## categories

**Model:** `Category` · **File:** `src/modules/catalog/category.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `category_number` | INTEGER | NO |  |  |  |
| `name` | TEXT | NO |  |  | Name |
| `slug` | VARCHAR(255) | NO |  |  |  |
| `parent_category_id` | CHAR(36) | YES |  | FK → categories.id |  |
| `image_url` | TEXT | YES |  |  |  |
| `description` | TEXT | YES |  |  |  |
| `tax_type` | ENUM('percentage', 'fixed') | YES |  |  |  |
| `tax_value` | DECIMAL(12,2) | YES |  |  |  |
| `tax_name` | VARCHAR(255) | YES |  |  |  |
| `discount_type` | ENUM('percentage', 'fixed') | YES |  |  |  |
| `discount_value` | DECIMAL(12,2) | YES |  |  |  |
| `discount_name` | VARCHAR(255) | YES |  |  |  |
| `is_active` | TINYINT(1) | NO | true |  | false = disabled (kept for history) |
| `sort_order` | INTEGER | NO | 0 |  |  |
| `is_pos_visible` | TINYINT(1) | NO | true |  | Shown on the POS |
| `is_web_visible` | TINYINT(1) | NO | true |  | Shown on the web store |
| `channel` | ENUM('web', 'pos', 'both') | NO | both |  | Where it belongs / was made: web, pos (or both) |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (store_id, slug)
- UNIQUE (store_id, category_number)

**Relations**

- BelongsTo `stores` via `store_id`
- BelongsTo `categories` via `parent_category_id` (as `parent`)
- HasMany `products` via `category_id`

---

## counters

**Model:** `Counter` · **File:** `src/shared/utils/counter.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `name` | VARCHAR(191) | NO |  | PK | Name |
| `seq` | INTEGER | NO | 0 |  |  |

---

## coupon_redemptions

**Model:** `CouponRedemption` · **File:** `src/modules/coupons/couponRedemption.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `coupon_id` | CHAR(36) | NO |  | FK → coupons.id |  |
| `order_id` | CHAR(36) | NO |  | FK → orders.id | Order |
| `user_id` | CHAR(36) | YES |  | FK → users.id | User (staff member / customer) |
| `amount` | DECIMAL(12,2) | NO |  |  |  |
| `created_at` | DATETIME | NO |  |  | When the row was created |

**Indexes**

- UNIQUE (coupon_id, order_id)

**Relations**

- BelongsTo `coupons` via `coupon_id`
- BelongsTo `orders` via `order_id`
- BelongsTo `users` via `user_id`
- BelongsTo `stores` via `store_id`

---

## coupons

**Model:** `Coupon` · **File:** `src/modules/coupons/coupon.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `location_id` | CHAR(36) | YES |  | FK → locations.id | Location (branch) this row belongs to |
| `code` | VARCHAR(64) | NO |  |  |  |
| `type` | ENUM('percentage', 'fixed') | NO |  |  |  |
| `value` | DECIMAL(12,2) | NO |  |  |  |
| `min_order_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `start_date` | DATETIME | YES |  |  |  |
| `end_date` | DATETIME | YES |  |  |  |
| `usage_limit` | INTEGER | YES |  |  |  |
| `used_count` | INTEGER | NO | 0 |  |  |
| `is_active` | TINYINT(1) | NO | true |  | false = disabled (kept for history) |
| `pos_enabled` | TINYINT(1) | NO | false |  |  |
| `web_enabled` | TINYINT(1) | NO | true |  |  |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (store_id, code)

**Relations**

- BelongsTo `stores` via `store_id`
- BelongsTo `locations` via `location_id`
- HasMany `coupon_redemptions` via `coupon_id`

---

## currencies

**Model:** `Currency` · **File:** `src/modules/stores/currency.model.js`

The store's currency (one row per store, created with the store).

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `code` | VARCHAR(3) | NO | PKR |  |  |
| `name` | VARCHAR(64) | NO | Pakistani Rupee |  | Name |
| `symbol` | VARCHAR(8) | NO | Rs |  |  |
| `decimal_places` | TINYINT | NO | 2 |  |  |
| `symbol_position` | ENUM('before', 'after') | NO | before |  |  |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (store_id)

**Relations**

- BelongsTo `stores` via `store_id`

---

## customer_credit_entries

**Model:** `CustomerCreditEntry` · **File:** `src/modules/customers/customerCreditEntry.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `customer_id` | CHAR(36) | NO |  | FK → customers.id | Customer |
| `order_id` | CHAR(36) | YES |  | FK → orders.id | Order |
| `entry_type` | ENUM('debit', 'credit') | NO |  |  |  |
| `amount` | DECIMAL(12,2) | NO |  |  |  |
| `due_date` | DATE | YES |  |  |  |
| `note` | TEXT | YES |  |  | Free-text note |
| `created_by` | CHAR(36) | YES |  | FK → users.id | User who created it |
| `is_pos_visible` | TINYINT(1) | NO | true |  | Shown on the POS |
| `is_web_visible` | TINYINT(1) | NO | true |  | Shown on the web store |
| `channel` | ENUM('web', 'pos', 'both') | NO | both |  | Where it belongs / was made: web, pos (or both) |
| `created_at` | DATETIME | NO |  |  | When the row was created |

**Relations**

- BelongsTo `customers` via `customer_id`
- BelongsTo `stores` via `store_id`
- BelongsTo `orders` via `order_id`
- BelongsTo `users` via `created_by` (as `createdBy`)

---

## customers

**Model:** `Customer` · **File:** `src/modules/customers/customer.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `customer_number` | INTEGER | NO |  |  |  |
| `location_id` | CHAR(36) | YES |  | FK → locations.id | Location (branch) this row belongs to |
| `user_id` | CHAR(36) | YES |  | FK → users.id | User (staff member / customer) |
| `name` | TEXT | NO |  |  | Name |
| `email` | VARCHAR(255) | YES |  |  |  |
| `phone` | VARCHAR(64) | YES |  |  |  |
| `total_debt` | DECIMAL(12,2) | NO | 0 |  |  |
| `remaining_debt` | DECIMAL(12,2) | NO | 0 |  |  |
| `debt_notes` | TEXT | YES |  |  |  |
| `is_active` | TINYINT(1) | NO | true |  | false = disabled (kept for history) |
| `is_pos_visible` | TINYINT(1) | NO | true |  | Shown on the POS |
| `is_web_visible` | TINYINT(1) | NO | true |  | Shown on the web store |
| `channel` | ENUM('web', 'pos', 'both') | NO | both |  | Where it belongs / was made: web, pos (or both) |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- (store_id, phone)
- UNIQUE (store_id, customer_number)

**Relations**

- BelongsTo `stores` via `store_id`
- BelongsTo `locations` via `location_id`
- BelongsTo `users` via `user_id`
- HasMany `customer_credit_entries` via `customer_id`

---

## locations

**Model:** `Location` · **File:** `src/modules/locations/location.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `location_id_int` | INTEGER | NO |  |  | Location number (short id) |
| `name` | TEXT | NO |  |  | Name |
| `address_line` | TEXT | NO |  |  |  |
| `city` | TEXT | NO |  |  |  |
| `country` | VARCHAR(8) | YES | PK |  |  |
| `postal_code` | VARCHAR(32) | YES |  |  |  |
| `phone` | VARCHAR(64) | YES |  |  |  |
| `is_default` | TINYINT(1) | NO | false |  |  |
| `is_active` | TINYINT(1) | NO | true |  | false = disabled (kept for history) |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (store_id, location_id_int)

**Relations**

- BelongsTo `stores` via `store_id`
- HasMany `users` via `location_id` (as `users`)

---

## offer_locations

**Model:** `OfferLocation` · **File:** `src/modules/offers/offerLocation.model.js`

A location an offer runs at (used when offers.location_scope is "selected").

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  |  | Store this row belongs to |
| `offer_id` | CHAR(36) | NO |  | FK → offers.id | Offer |
| `location_id` | CHAR(36) | NO |  | FK → locations.id | Location (branch) this row belongs to |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (offer_id, location_id)

**Relations**

- BelongsTo `offers` via `offer_id`
- BelongsTo `locations` via `location_id`

---

## offer_targets

**Model:** `OfferTarget` · **File:** `src/modules/offers/offerTarget.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `offer_id` | CHAR(36) | NO |  | FK → offers.id | Offer |
| `product_id` | CHAR(36) | YES |  | FK → products.id | Product |
| `category_id` | CHAR(36) | YES |  | FK → categories.id | Category |
| `free_product_id` | CHAR(36) | YES |  | FK → products.id |  |
| `promo_price` | DECIMAL(12,2) | YES |  |  |  |

**Relations**

- BelongsTo `offers` via `offer_id`
- BelongsTo `products` via `product_id` (as `product`)
- BelongsTo `categories` via `category_id`
- BelongsTo `products` via `free_product_id` (as `freeProduct`)

---

## offers

**Model:** `Offer` · **File:** `src/modules/offers/offer.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `offer_number` | INTEGER | NO |  |  |  |
| `name` | TEXT | NO |  |  | Name |
| `type` | ENUM('flash_sale', 'bulk_discount', 'bogo', 'promotional') | NO |  |  |  |
| `apply_to` | ENUM('product', 'category') | NO |  |  |  |
| `location_scope` | ENUM('all', 'selected') | NO | all |  | "all" = every location; "selected" = only the locations in offer_locations. |
| `discount_type` | ENUM('percentage', 'fixed') | YES |  |  |  |
| `discount_value` | DECIMAL(12,2) | YES |  |  |  |
| `min_qty` | DECIMAL(12,4) | YES |  |  |  |
| `buy_qty` | INTEGER | YES |  |  |  |
| `get_qty` | INTEGER | YES |  |  |  |
| `start_at` | DATETIME | YES |  |  |  |
| `end_at` | DATETIME | YES |  |  |  |
| `is_active` | TINYINT(1) | NO | true |  | false = disabled (kept for history) |
| `created_by` | CHAR(36) | YES |  | FK → users.id | User who created it |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (store_id, offer_number)

**Relations**

- BelongsTo `stores` via `store_id`
- HasMany `offer_locations` via `offer_id` (as `offerLocations`)
- BelongsTo `users` via `created_by` (as `createdBy`)
- HasMany `offer_targets` via `offer_id`

---

## order_items

**Model:** `OrderItem` · **File:** `src/modules/orders/orderItem.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `order_id` | CHAR(36) | NO |  | FK → orders.id | Order |
| `item_number` | INTEGER | NO |  |  | Per-order line number (1,2,3...), assigned by position when the order's items are saved. |
| `is_pos_visible` | TINYINT(1) | NO | true |  | Shown on the POS |
| `is_web_visible` | TINYINT(1) | NO | true |  | Shown on the web store |
| `channel` | ENUM('web', 'pos') | NO | pos |  | Where it belongs / was made: web, pos (or both) |
| `product_id` | CHAR(36) | YES |  | FK → products.id | Product |
| `title` | TEXT | NO |  |  | Title |
| `custom_category` | VARCHAR(255) | YES |  |  | Custom sale lines only: the category typed at the till (no catalog product behind it). |
| `sku` | VARCHAR(255) | YES |  |  |  |
| `barcode` | VARCHAR(255) | YES |  |  |  |
| `unit` | ENUM('piece', 'kg', 'gram', 'liter', 'ml', 'packet', 'box', 'dozen', 'pair', 'meter', 'yard', 'roll', 'set', 'carton', 'bag', 'bottle', 'can') | YES |  |  |  |
| `is_weight_based` | TINYINT(1) | NO | false |  |  |
| `weight` | DECIMAL(12,4) | YES |  |  |  |
| `qty_packs` | DECIMAL(12,4) | YES |  |  |  |
| `unit_price` | DECIMAL(12,2) | NO |  |  |  |
| `cost_price` | DECIMAL(12,2) | NO | 0 |  |  |
| `quantity` | DECIMAL(12,4) | NO |  |  |  |
| `refunded_qty` | DECIMAL(12,4) | NO | 0 |  |  |
| `discount_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `tax_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `product_tax_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `category_tax_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `sales_tax_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `product_taxes` | JSON | YES |  |  | Snapshot of the product taxes charged on this line: [{ name, type, value, amount }]. |
| `category_tax_type` | VARCHAR(32) | YES |  |  |  |
| `category_tax_value` | DECIMAL(5,2) | YES |  |  |  |
| `subtotal` | DECIMAL(12,2) | NO |  |  |  |

**Indexes**

- UNIQUE (order_id, item_number)

**Relations**

- BelongsTo `orders` via `order_id`
- BelongsTo `products` via `product_id`

---

## order_refund_items

**Model:** `OrderRefundItem` · **File:** `src/modules/orders/orderRefundItem.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `refund_id` | CHAR(36) | NO |  | FK → order_refunds.id |  |
| `item_number` | INTEGER | NO |  |  | Per-refund line number (1,2,3...). |
| `is_pos_visible` | TINYINT(1) | NO | true |  | Shown on the POS |
| `is_web_visible` | TINYINT(1) | NO | true |  | Shown on the web store |
| `channel` | ENUM('web', 'pos') | NO | pos |  | Where it belongs / was made: web, pos (or both) |
| `order_item_id` | CHAR(36) | NO |  | FK → order_items.id |  |
| `product_id` | CHAR(36) | YES |  |  | Product |
| `title` | TEXT | NO |  |  | Title |
| `quantity` | DECIMAL(12,4) | NO |  |  |  |
| `unit_price` | DECIMAL(12,2) | NO |  |  |  |
| `tax_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `subtotal` | DECIMAL(12,2) | NO |  |  |  |

**Indexes**

- UNIQUE (refund_id, item_number)

**Relations**

- BelongsTo `order_refunds` via `refund_id`
- BelongsTo `order_items` via `order_item_id`

---

## order_refunds

**Model:** `OrderRefund` · **File:** `src/modules/orders/orderRefund.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  |  | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `refund_number` | INTEGER | NO |  |  |  |
| `location_id` | CHAR(36) | YES |  |  | Location (branch) this row belongs to |
| `location_id_int` | INTEGER | YES |  |  | Location number (short id) |
| `order_id` | CHAR(36) | NO |  | FK → orders.id | Order |
| `cashier_id` | CHAR(36) | YES |  | FK → users.id | Staff member who did it |
| `receipt_id` | CHAR(36) | YES |  | FK → receipts.id |  |
| `reason` | TEXT | NO |  |  | Reason |
| `amount` | DECIMAL(12,2) | NO |  |  |  |
| `tax_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `is_pos_visible` | TINYINT(1) | NO | true |  | Shown on the POS |
| `is_web_visible` | TINYINT(1) | NO | true |  | Shown on the web store |
| `channel` | ENUM('web', 'pos') | NO | pos |  | Where it belongs / was made: web, pos (or both) |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- (store_id, order_id)
- UNIQUE (store_id, refund_number)

**Relations**

- BelongsTo `orders` via `order_id`
- BelongsTo `users` via `cashier_id` (as `cashier`)
- BelongsTo `receipts` via `receipt_id`
- HasMany `order_refund_items` via `refund_id`

---

## orders

**Model:** `Order` · **File:** `src/modules/orders/order.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `location_id` | CHAR(36) | YES |  | FK → locations.id | Location (branch) this row belongs to |
| `location_id_int` | INTEGER | YES |  |  | Location number (short id) |
| `channel` | ENUM('web', 'pos') | NO |  |  | Where it belongs / was made: web, pos (or both) |
| `is_pos_visible` | TINYINT(1) | NO | true |  | Shown on the POS |
| `is_web_visible` | TINYINT(1) | NO | true |  | Shown on the web store |
| `is_custom` | TINYINT(1) | NO | false |  |  |
| `order_number` | INTEGER | NO |  |  |  |
| `cashier_id` | CHAR(36) | YES |  | FK → users.id | Staff member who did it |
| `customer_id` | CHAR(36) | YES |  | FK → customers.id | Customer |
| `register_session_id` | CHAR(36) | YES |  | FK → register_sessions.id | Batch (cash drawer session) it was booked into |
| `client_local_id` | VARCHAR(255) | YES |  |  |  |
| `gross_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `line_discount_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `subtotal` | DECIMAL(12,2) | NO | 0 |  |  |
| `is_order_discounted` | TINYINT(1) | NO | false |  |  |
| `order_discount_type` | ENUM('percentage', 'fixed') | YES |  |  |  |
| `discount_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `coupon_id` | CHAR(36) | YES |  | FK → coupons.id |  |
| `coupon_code` | VARCHAR(64) | YES |  |  |  |
| `coupon_discount_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `tax_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `sales_tax_rate` | DECIMAL(5,2) | YES |  |  |  |
| `sales_tax_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `product_tax_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `category_tax_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `payment_gst_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `fbr_invoice_enabled` | TINYINT(1) | NO | false |  |  |
| `fbr_tax_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `tax_breakdown` | JSON | YES |  |  |  |
| `shipping_fee` | DECIMAL(12,2) | NO | 0 |  |  |
| `total_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `cost_total` | DECIMAL(12,2) | NO | 0 |  |  |
| `payment_method` | ENUM('cash', 'card', 'jazzcash', 'easypaisa', 'cod', 'mixed') | NO |  |  |  |
| `payment_status` | ENUM('pending', 'paid', 'failed', 'refunded') | NO | pending |  |  |
| `shipping_address` | TEXT | YES |  |  |  |
| `order_status` | ENUM('pending', 'completed', 'voided', 'cancelled', 'refunded') | NO | pending |  |  |
| `amount_paid` | DECIMAL(12,2) | NO | 0 |  |  |
| `change_due` | DECIMAL(12,2) | YES |  |  |  |
| `void_reason` | TEXT | YES |  |  |  |
| `voided_by` | CHAR(36) | YES |  | FK → users.id |  |
| `cancel_reason` | TEXT | YES |  |  |  |
| `cancelled_by` | CHAR(36) | YES |  | FK → users.id |  |
| `placed_at` | DATETIME | NO | now |  |  |
| `synced_at` | DATETIME | YES |  |  |  |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (store_id, order_number)
- UNIQUE (store_id, client_local_id)
- (store_id, placed_at)
- (store_id, location_id, channel, order_status)

**Relations**

- BelongsTo `stores` via `store_id`
- BelongsTo `locations` via `location_id`
- BelongsTo `users` via `cashier_id` (as `cashier`)
- BelongsTo `customers` via `customer_id` (as `customer`)
- BelongsTo `register_sessions` via `register_session_id`
- BelongsTo `coupons` via `coupon_id`
- BelongsTo `users` via `voided_by` (as `voidedBy`)
- BelongsTo `users` via `cancelled_by` (as `cancelledBy`)
- HasMany `order_items` via `order_id`
- HasMany `order_refunds` via `order_id`
- HasMany `payments` via `order_id`

---

## payment_method_tax_rates

**Model:** `PaymentMethodTaxRate` · **File:** `src/modules/stores/paymentMethodTaxRate.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `payment_method` | ENUM('cash', 'card', 'jazzcash', 'easypaisa', 'cod', 'mixed') | NO |  |  |  |
| `gst_percent` | DECIMAL(5,2) | NO | 0 |  |  |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (store_id, payment_method)

**Relations**

- BelongsTo `stores` via `store_id`

---

## payments

**Model:** `Payment` · **File:** `src/modules/payments/payment.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `location_id` | CHAR(36) | YES |  | FK → locations.id | Location (branch) this row belongs to |
| `location_id_int` | INTEGER | YES |  |  | Location number (short id) |
| `order_id` | CHAR(36) | NO |  | FK → orders.id | Order |
| `is_pos_visible` | TINYINT(1) | NO | true |  | Shown on the POS |
| `is_web_visible` | TINYINT(1) | NO | true |  | Shown on the web store |
| `channel` | ENUM('web', 'pos') | NO | pos |  | Where it belongs / was made: web, pos (or both) |
| `method` | ENUM('cash', 'card', 'jazzcash', 'easypaisa', 'cod', 'mixed') | NO |  |  |  |
| `amount` | DECIMAL(12,2) | NO |  |  |  |
| `tax_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `currency` | VARCHAR(16) | NO | PKR |  |  |
| `status` | ENUM('initiated', 'success', 'failed') | NO | initiated |  | Current state (see the enum values) |
| `gateway_transaction_id` | VARCHAR(255) | YES |  |  |  |
| `idempotency_key` | VARCHAR(255) | YES |  |  |  |
| `raw_payload` | JSON | YES |  |  |  |
| `paid_at` | DATETIME | YES |  |  |  |
| `failure_reason` | TEXT | YES |  |  |  |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (store_id, gateway_transaction_id)

**Relations**

- BelongsTo `stores` via `store_id`
- BelongsTo `locations` via `location_id`
- BelongsTo `orders` via `order_id`

---

## plans

**Model:** `Plan` · **File:** `src/modules/plans/plan.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `plan_number` | INTEGER | NO |  | UNIQUE | Short, human-friendly number for client-facing responses (e.g. POS license validation) that shouldn't expose the internal UUID. DB auto-increments it; never set on create. |
| `code` | VARCHAR(64) | NO |  | UNIQUE |  |
| `type` | ENUM('monthly', 'yearly') | NO | monthly |  |  |
| `name` | VARCHAR(255) | NO |  |  | Name |
| `price_pkr` | DECIMAL(12,2) | NO |  |  |  |
| `max_devices` | INTEGER | NO |  |  |  |
| `max_locations` | INTEGER | NO |  |  |  |
| `max_users` | INTEGER | YES |  |  | null = no limit on staff accounts. |
| `reporting_level` | ENUM('basic', 'standard', 'advanced', 'custom') | NO | basic |  |  |
| `import_export` | TINYINT(1) | NO | false |  |  |
| `staff_attendance` | TINYINT(1) | NO | false |  |  |
| `email_integration` | TINYINT(1) | NO | false |  |  |
| `whatsapp_integration` | TINYINT(1) | NO | false |  |  |
| `receipt_customization` | TINYINT(1) | NO | false |  |  |
| `barcode_scanning` | TINYINT(1) | NO | false |  |  |
| `batch_management` | TINYINT(1) | NO | false |  |  |
| `remote_access` | TINYINT(1) | NO | false |  |  |
| `features` | JSON | NO | [] |  | Free-text selling points shown on the plan card. |
| `is_active` | TINYINT(1) | NO | true |  | false = disabled (kept for history) |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Relations**

- HasMany `stores` via `plan_id`

---

## pos_devices

**Model:** `PosDevice` · **File:** `src/modules/pos/posDevice.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `device_number` | INTEGER | NO |  |  |  |
| `location_id` | CHAR(36) | YES |  | FK → locations.id | Null until the store admin assigns the till to a branch (PATCH /pos-devices/:id). |
| `location_id_int` | INTEGER | YES |  |  | Location number (short id) |
| `device_uid` | VARCHAR(255) | NO |  |  |  |
| `name` | VARCHAR(255) | NO |  |  | Name |
| `platform` | VARCHAR(255) | YES |  |  |  |
| `app_version` | VARCHAR(255) | YES |  |  |  |
| `last_seen_at` | DATETIME | YES |  |  |  |
| `is_active` | TINYINT(1) | NO | true |  | false = disabled (kept for history) |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (store_id, device_uid)
- UNIQUE (store_id, device_number)

**Relations**

- HasOne `store_licenses` via `device_id` (as `license`)
- BelongsTo `stores` via `store_id`
- BelongsTo `locations` via `location_id`

---

## product_bulk_tiers

**Model:** `ProductBulkTier` · **File:** `src/modules/catalog/productBulkTier.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `product_id` | CHAR(36) | NO |  | FK → products.id | Product |
| `min_qty` | DECIMAL(12,4) | NO |  |  |  |
| `discount_type` | ENUM('percentage', 'fixed') | NO |  |  |  |
| `discount_value` | DECIMAL(12,2) | NO |  |  |  |
| `is_pos_visible` | TINYINT(1) | NO | true |  | Shown on the POS |
| `is_web_visible` | TINYINT(1) | NO | true |  | Shown on the web store |
| `channel` | ENUM('web', 'pos', 'both') | NO | both |  | Where it belongs / was made: web, pos (or both) |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (product_id, min_qty)

**Relations**

- BelongsTo `products` via `product_id`
- BelongsTo `stores` via `store_id`

---

## product_stocks

**Model:** `ProductStock` · **File:** `src/modules/catalog/productStock.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `location_id` | CHAR(36) | NO |  | FK → locations.id | Location (branch) this row belongs to |
| `location_id_int` | INTEGER | NO |  |  | Location number (short id) |
| `product_id` | CHAR(36) | NO |  | FK → products.id | Product |
| `qty` | DECIMAL(12,4) | NO | 0 |  |  |
| `unit_sold` | DECIMAL(12,4) | NO | 0 |  | Units sold so far at this location (sales add, refunds take back). |
| `low_stock_threshold` | DECIMAL(12,4) | YES |  |  |  |
| `expiry_date` | DATE | YES |  |  |  |
| `is_pos_visible` | TINYINT(1) | NO | true |  | Shown on the POS |
| `is_web_visible` | TINYINT(1) | NO | true |  | Shown on the web store |
| `channel` | ENUM('web', 'pos', 'both') | NO | both |  | Where it belongs / was made: web, pos (or both) |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (location_id, product_id)
- (store_id, location_id)
- (location_id, qty)

**Relations**

- BelongsTo `products` via `product_id`
- BelongsTo `stores` via `store_id`
- BelongsTo `locations` via `location_id`

---

## products

**Model:** `Product` · **File:** `src/modules/catalog/product.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `product_number` | INTEGER | NO |  |  |  |
| `category_id` | CHAR(36) | NO |  | FK → categories.id | Category |
| `title` | TEXT | NO |  |  | Title |
| `slug` | VARCHAR(255) | NO |  |  |  |
| `sku` | VARCHAR(255) | NO |  |  |  |
| `barcode` | VARCHAR(255) | YES |  |  |  |
| `images` | JSON | YES | [] |  |  |
| `featured_image` | TEXT | YES |  |  |  |
| `description` | TEXT | YES |  |  |  |
| `unit` | ENUM('piece', 'kg', 'gram', 'liter', 'ml', 'packet', 'box', 'dozen', 'pair', 'meter', 'yard', 'roll', 'set', 'carton', 'bag', 'bottle', 'can') | NO | piece |  |  |
| `cost_price` | DECIMAL(12,2) | NO |  |  |  |
| `selling_price` | DECIMAL(12,2) | NO |  |  |  |
| `has_product_discount` | TINYINT(1) | NO | false |  | Derived on create/update from whether discount_type + discount_value are set, unless the client sends it explicitly. Kept as a column because net_selling_price is generated from it. |
| `discount_type` | ENUM('percentage', 'fixed') | YES |  |  |  |
| `discount_value` | DECIMAL(12,2) | YES |  |  |  |
| `discount_name` | VARCHAR(255) | YES |  |  |  |
| `taxes` | JSON | YES | [] |  | Product-level taxes, any number: [{ name, type: percentage \| fixed, value }]. A fixed tax is per unit. Applied with the category tax and the store's sales tax at checkout. |
| `is_pack_product` | TINYINT(1) | NO | false |  |  |
| `pack_size` | INTEGER | YES |  |  |  |
| `pack_cost_price` | DECIMAL(12,2) | YES |  |  | Whole-pack cost/price, independent of cost_price/selling_price × pack_size (bulk purchase/ sale economics differ from per-unit). Required when is_pack_product — see assertPackRules. |
| `pack_selling_price` | DECIMAL(12,2) | YES |  |  |  |
| `sell_loose` | TINYINT(1) | NO | false |  |  |
| `is_weight_based` | TINYINT(1) | NO | false |  |  |
| `has_bulk_discount` | TINYINT(1) | NO | false |  |  |
| `low_stock_threshold` | DECIMAL(12,4) | NO | 10 |  |  |
| `total_price_each_unit` | DECIMAL(12,2) | YES |  |  | MySQL STORED generated column (computed by the database) |
| `total_pack_price` | DECIMAL(12,2) | YES |  |  | MySQL STORED generated column (computed by the database) |
| `is_published` | TINYINT(1) | NO | false |  |  |
| `is_pos_visible` | TINYINT(1) | NO | true |  | Shown on the POS |
| `is_web_visible` | TINYINT(1) | NO | true |  | Shown on the web store |
| `channel` | ENUM('web', 'pos', 'both') | NO | both |  | Where it belongs / was made: web, pos (or both) |
| `is_active` | TINYINT(1) | NO | true |  | false = disabled (kept for history) |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (store_id, product_number)
- UNIQUE (store_id, sku)
- UNIQUE (store_id, slug)
- UNIQUE (store_id, barcode)
- (store_id, is_published)
- (store_id, category_id)

**Relations**

- BelongsTo `stores` via `store_id`
- BelongsTo `categories` via `category_id`
- HasMany `product_stocks` via `product_id`
- HasMany `product_bulk_tiers` via `product_id`

---

## receipts

**Model:** `Receipt` · **File:** `src/modules/payments/receipt.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `location_id` | CHAR(36) | YES |  | FK → locations.id | Location (branch) this row belongs to |
| `location_id_int` | INTEGER | YES |  |  | Location number (short id) |
| `order_id` | CHAR(36) | NO |  | FK → orders.id | Order |
| `is_pos_visible` | TINYINT(1) | NO | true |  | Shown on the POS |
| `is_web_visible` | TINYINT(1) | NO | true |  | Shown on the web store |
| `channel` | ENUM('web', 'pos') | NO | pos |  | Where it belongs / was made: web, pos (or both) |
| `payment_id` | CHAR(36) | YES |  | FK → payments.id |  |
| `receipt_number` | INTEGER | NO |  |  |  |
| `cashier_id` | CHAR(36) | YES |  | FK → users.id | Staff member who did it |
| `subtotal` | DECIMAL(12,2) | NO | 0 |  |  |
| `discount_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `tax_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `shipping_fee` | DECIMAL(12,2) | NO | 0 |  |  |
| `total_amount` | DECIMAL(12,2) | NO | 0 |  |  |
| `issued_at` | DATETIME | NO | now |  |  |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (store_id, receipt_number)

**Relations**

- BelongsTo `stores` via `store_id`
- BelongsTo `locations` via `location_id`
- BelongsTo `orders` via `order_id`
- BelongsTo `payments` via `payment_id`
- BelongsTo `users` via `cashier_id` (as `cashier`)

---

## register_sessions

**Model:** `RegisterSession` · **File:** `src/modules/pos/registerSession.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `session_number` | INTEGER | NO |  |  |  |
| `location_id` | CHAR(36) | NO |  | FK → locations.id | Location (branch) this row belongs to |
| `location_id_int` | INTEGER | NO |  |  | Location number (short id) |
| `cashier_id` | CHAR(36) | NO |  | FK → users.id | Staff member who did it |
| `device_id` | CHAR(36) | YES |  | FK → pos_devices.id | POS device (till) |
| `status` | ENUM('open', 'closed') | NO | open |  | A batch (cash drawer): open from batch opening until batch closing. |
| `staff_session_id` | CHAR(36) | YES |  | FK → staff_sessions.id | The staff session (clock in) this batch was opened during, if any. |
| `opening_cash` | DECIMAL(12,2) | NO |  |  |  |
| `cash_in` | DECIMAL(12,2) | NO | 0 |  |  |
| `cash_out` | DECIMAL(12,2) | NO | 0 |  |  |
| `cash_sales` | DECIMAL(12,2) | NO | 0 |  |  |
| `card_sales` | DECIMAL(12,2) | NO | 0 |  |  |
| `jazzcash_sales` | DECIMAL(12,2) | NO | 0 |  |  |
| `easypaisa_sales` | DECIMAL(12,2) | NO | 0 |  |  |
| `total_sales` | DECIMAL(12,2) | NO | 0 |  |  |
| `net_sales` | DECIMAL(12,2) | NO | 0 |  |  |
| `expected_cash` | DECIMAL(12,2) | YES |  |  |  |
| `note_5000_count` | INTEGER | YES |  |  |  |
| `note_1000_count` | INTEGER | YES |  |  |  |
| `note_500_count` | INTEGER | YES |  |  |  |
| `note_100_count` | INTEGER | YES |  |  |  |
| `note_50_count` | INTEGER | YES |  |  |  |
| `note_20_count` | INTEGER | YES |  |  |  |
| `coins_total` | DECIMAL(12,2) | YES |  |  |  |
| `counted_cash` | DECIMAL(12,2) | YES |  |  |  |
| `closing_cash` | DECIMAL(12,2) | YES |  |  |  |
| `cash_variance` | DECIMAL(12,2) | YES |  |  |  |
| `note` | TEXT | YES |  |  | Free-text note |
| `opened_at` | DATETIME | NO | now |  |  |
| `closed_at` | DATETIME | YES |  |  |  |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- (store_id, location_id, status)
- UNIQUE (store_id, session_number)

**Relations**

- BelongsTo `stores` via `store_id`
- BelongsTo `locations` via `location_id`
- BelongsTo `users` via `cashier_id` (as `cashier`)
- BelongsTo `pos_devices` via `device_id` (as `device`)
- BelongsTo `staff_sessions` via `staff_session_id`

---

## reviews

**Model:** `Review` · **File:** `src/modules/reviews/review.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `product_id` | CHAR(36) | NO |  | FK → products.id | Product |
| `user_id` | CHAR(36) | YES |  | FK → users.id | User (staff member / customer) |
| `rating` | INTEGER | NO |  |  |  |
| `comment` | TEXT | YES |  |  |  |
| `status` | ENUM('pending', 'approved', 'rejected') | NO | pending |  | Current state (see the enum values) |
| `reviewed_by` | CHAR(36) | YES |  | FK → users.id |  |
| `reviewed_at` | DATETIME | YES |  |  |  |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (user_id, product_id)

**Relations**

- BelongsTo `stores` via `store_id`
- BelongsTo `products` via `product_id`
- BelongsTo `users` via `user_id`
- BelongsTo `users` via `reviewed_by` (as `reviewer`)

---

## shipping_rules

**Model:** `ShippingRule` · **File:** `src/modules/stores/shippingRule.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `flat_fee` | DECIMAL(12,2) | NO | 0 |  |  |
| `free_over_amount` | DECIMAL(12,2) | YES |  |  |  |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (store_id)

**Relations**

- BelongsTo `stores` via `store_id`

---

## staff_sessions

**Model:** `StaffSession` · **File:** `src/modules/pos/staffSession.model.js`

Staff attendance: one row from clock in until clock out. Separate from the cash drawer (register_sessions = batch opening / closing).

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `session_number` | INTEGER | NO |  |  | Per-store sequence (1,2,3...) — the id the POS sees. |
| `location_id` | CHAR(36) | YES |  | FK → locations.id | Location (branch) this row belongs to |
| `location_id_int` | INTEGER | YES |  |  | Location number (short id) |
| `user_id` | CHAR(36) | NO |  | FK → users.id | User (staff member / customer) |
| `device_id` | CHAR(36) | YES |  |  | POS device (till) |
| `status` | ENUM('clock_in', 'clock_out') | NO | clock_in |  | Current state (see the enum values) |
| `clock_in_at` | DATETIME | NO |  |  |  |
| `clock_out_at` | DATETIME | YES |  |  |  |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (store_id, session_number)
- (store_id, user_id, status)

**Relations**

- BelongsTo `stores` via `store_id`
- BelongsTo `locations` via `location_id`
- BelongsTo `users` via `user_id` (as `staff`)

---

## stock_movements

**Model:** `StockMovement` · **File:** `src/modules/inventory/stockMovement.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `movement_number` | INTEGER | NO |  |  |  |
| `location_id` | CHAR(36) | NO |  | FK → locations.id | Location (branch) this row belongs to |
| `location_id_int` | INTEGER | NO |  |  | Location number (short id) |
| `product_id` | CHAR(36) | NO |  | FK → products.id | Product |
| `movement_type` | ENUM('stock_in', 'stock_out', 'adjustment', 'sale', 'refund', 'transfer_out', 'transfer_in', 'custom_sale') | NO |  |  |  |
| `reason` | ENUM('purchase', 'opening_balance', 'return_to_supplier', 'customer_return', 'waste', 'damage', 'expiry', 'theft', 'count', 'sale', 'refund', 'sync', 'transfer', 'custom_sale', 'other') | NO |  |  | Reason |
| `reason_note` | TEXT | YES |  |  |  |
| `qty` | DECIMAL(12,4) | NO |  |  |  |
| `qty_after` | DECIMAL(12,4) | YES |  |  |  |
| `unit_sold` | DECIMAL(12,4) | YES |  |  | product_stocks.unit_sold right after this movement (running total of units sold). |
| `supplier_id` | CHAR(36) | YES |  | FK → suppliers.id | Supplier |
| `staff_id` | CHAR(36) | YES |  | FK → users.id | Staff member who did it |
| `order_id` | CHAR(36) | YES |  | FK → orders.id | Order |
| `is_pos_visible` | TINYINT(1) | NO | true |  | Shown on the POS |
| `is_web_visible` | TINYINT(1) | NO | true |  | Shown on the web store |
| `channel` | ENUM('web', 'pos', 'both') | NO | both |  | Where it belongs / was made: web, pos (or both) |
| `created_at` | DATETIME | NO |  |  | When the row was created |

**Indexes**

- (store_id, product_id, created_at)
- UNIQUE (store_id, movement_number)

**Relations**

- BelongsTo `stores` via `store_id`
- BelongsTo `locations` via `location_id`
- BelongsTo `products` via `product_id`
- BelongsTo `suppliers` via `supplier_id`
- BelongsTo `users` via `staff_id` (as `staff`)
- BelongsTo `orders` via `order_id`

---

## stock_transfers

**Model:** `StockTransfer` · **File:** `src/modules/inventory/stockTransfer.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `transfer_number` | INTEGER | NO |  |  |  |
| `from_location_id` | CHAR(36) | NO |  | FK → locations.id |  |
| `to_location_id` | CHAR(36) | NO |  | FK → locations.id |  |
| `product_id` | CHAR(36) | NO |  | FK → products.id | Product |
| `qty` | DECIMAL(12,4) | NO |  |  |  |
| `status` | ENUM('pending', 'on_the_way', 'completed', 'cancelled') | NO | on_the_way |  | Current state (see the enum values) |
| `note` | TEXT | YES |  |  | Free-text note |
| `created_by` | CHAR(36) | YES |  | FK → users.id | User who created it |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (store_id, transfer_number)

**Relations**

- BelongsTo `stores` via `store_id`
- BelongsTo `locations` via `from_location_id` (as `fromLocation`)
- BelongsTo `locations` via `to_location_id` (as `toLocation`)
- BelongsTo `products` via `product_id`
- BelongsTo `users` via `created_by` (as `createdBy`)

---

## store_backups

**Model:** `StoreBackup` · **File:** `src/modules/stores/storeBackup.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `file_url` | TEXT | YES |  |  |  |
| `note` | TEXT | YES |  |  | Free-text note |
| `created_by` | CHAR(36) | YES |  | FK → users.id | User who created it |
| `created_at` | DATETIME | NO |  |  | When the row was created |

**Relations**

- BelongsTo `stores` via `store_id`
- BelongsTo `users` via `created_by` (as `createdBy`)

---

## store_banners

**Model:** `StoreBanner` · **File:** `src/modules/stores/storeBanner.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `image_url` | TEXT | NO |  |  |  |
| `heading` | TEXT | YES |  |  |  |
| `link_url` | TEXT | YES |  |  |  |
| `sort_order` | INTEGER | NO | 0 |  |  |
| `is_active` | TINYINT(1) | NO | true |  | false = disabled (kept for history) |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Relations**

- BelongsTo `stores` via `store_id`

---

## store_licenses

**Model:** `StoreLicense` · **File:** `src/modules/stores/storeLicense.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `plan_id` | CHAR(36) | NO |  | FK → plans.id | Plan |
| `license_key` | VARCHAR(255) | NO |  | UNIQUE |  |
| `status` | ENUM('pending', 'trial', 'active', 'expired', 'revoked', 'suspended') | NO | pending |  | Current state (see the enum values) |
| `device_id` | CHAR(36) | YES |  | FK → pos_devices.id | POS device (till) |
| `device_uuids` | JSON | NO | [] |  |  |
| `starts_at` | DATETIME | NO |  |  |  |
| `expires_at` | DATETIME | NO |  |  |  |
| `grace_days` | INTEGER | NO | 0 |  | Days added by "extend" that the next renewal takes back. |
| `suspended_at` | DATETIME | YES |  |  |  |
| `suspended_reason` | TEXT | YES |  |  |  |
| `revoked_at` | DATETIME | YES |  |  |  |
| `revoked_reason` | TEXT | YES |  |  |  |
| `renewed_at` | DATETIME | YES |  |  | Last time the license was renewed (or converted from trial to a paid plan). |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- (status, expires_at)

**Relations**

- BelongsTo `stores` via `store_id`
- BelongsTo `plans` via `plan_id`
- BelongsTo `pos_devices` via `device_id` (as `device`)

---

## store_themes

**Model:** `StoreTheme` · **File:** `src/modules/stores/storeTheme.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `primary` | TEXT | NO |  |  |  |
| `secondary` | TEXT | NO |  |  |  |
| `accent` | TEXT | NO |  |  |  |
| `btn_filled_bg` | TEXT | YES |  |  |  |
| `btn_filled_text` | TEXT | YES |  |  |  |
| `btn_filled_hover` | TEXT | YES |  |  |  |
| `btn_outline_border` | TEXT | YES |  |  |  |
| `btn_outline_text` | TEXT | YES |  |  |  |
| `btn_outline_hover` | TEXT | YES |  |  |  |
| `btn_text_color` | TEXT | YES |  |  |  |
| `btn_text_hover` | TEXT | YES |  |  |  |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (store_id)

**Relations**

- BelongsTo `stores` via `store_id`

---

## stores

**Model:** `Store` · **File:** `src/modules/stores/store.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id_int` | INTEGER | NO |  | UNIQUE | Store number (short id) |
| `plan_id` | CHAR(36) | NO |  | FK → plans.id | Plan |
| `name` | TEXT | NO |  |  | Name |
| `slug` | VARCHAR(255) | NO |  | UNIQUE |  |
| `custom_domain` | VARCHAR(255) | YES |  |  |  |
| `legal_name` | VARCHAR(255) | YES |  |  |  |
| `owner_name` | VARCHAR(255) | YES |  |  |  |
| `business_type` | ENUM('grocery', 'boutique', 'retail', 'pharmacy', 'restaurant', 'cafe', 'bakery', 'electronics', 'fashion', 'clothing', 'beauty', 'furniture', 'hardware', 'sports', 'books', 'jewelry', 'supermarket', 'convenience', 'wholesale', 'other') | NO |  |  |  |
| `address` | TEXT | NO |  |  |  |
| `city` | VARCHAR(255) | YES |  |  |  |
| `contact_email` | VARCHAR(255) | NO |  |  |  |
| `contact_phone` | VARCHAR(255) | NO |  |  |  |
| `logo_url` | TEXT | YES |  |  |  |
| `favicon_url` | TEXT | YES |  |  |  |
| `currency` | VARCHAR(16) | NO | PKR |  |  |
| `timezone` | VARCHAR(64) | NO | Asia/Karachi |  |  |
| `ntn` | VARCHAR(255) | YES |  |  |  |
| `strn` | VARCHAR(255) | YES |  |  |  |
| `fbr_invoice_enabled` | TINYINT(1) | NO | false |  |  |
| `charge_tax_on_sales` | TINYINT(1) | NO | false |  |  |
| `sales_tax_rate` | DECIMAL(5,2) | YES | 18 |  | Sales tax: one store-wide % on every taxable line, while sales_tax_enabled is on. The owner switches it off when each product carries its own sales tax instead. |
| `sales_tax_enabled` | TINYINT(1) | NO | true |  |  |
| `payment_tax_enabled` | TINYINT(1) | NO | true |  | Payment-method GST (payment_method_tax_rates) applies only while this is on. |
| `expiry_warning_days` | INTEGER | NO | 30 |  |  |
| `expiry_critical_days` | INTEGER | NO | 7 |  |  |
| `receipt_footer` | TEXT | YES |  |  |  |
| `pos_enabled` | TINYINT(1) | NO | true |  |  |
| `web_enabled` | TINYINT(1) | NO | true |  |  |
| `admin_id` | CHAR(36) | YES |  | FK → users.id |  |
| `default_location_id` | CHAR(36) | YES |  | FK → locations.id |  |
| `default_location_id_int` | INTEGER | YES |  |  |  |
| `account_manager_name` | VARCHAR(255) | YES |  |  |  |
| `account_manager_phone` | VARCHAR(255) | YES |  |  |  |
| `is_active` | TINYINT(1) | NO | true |  | false = disabled (kept for history) |
| `status` | ENUM('trial', 'active') | NO | active |  | trial = free trial (ends at trial_ends_at); active = a purchased plan. |
| `trial_ends_at` | DATETIME | YES |  |  |  |
| `is_live` | TINYINT(1) | NO | false |  |  |
| `suspend_reason` | TEXT | YES |  |  |  |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Relations**

- BelongsTo `plans` via `plan_id`
- BelongsTo `users` via `admin_id` (as `admin`)
- HasMany `locations` via `store_id`
- BelongsTo `locations` via `default_location_id` (as `defaultLocation`)
- HasOne `store_themes` via `store_id`
- HasOne `website_content` via `store_id`
- HasOne `shipping_rules` via `store_id`
- HasMany `store_banners` via `store_id`
- HasMany `payment_method_tax_rates` via `store_id`
- HasOne `currencies` via `store_id`
- HasMany `store_licenses` via `store_id`
- HasMany `store_backups` via `store_id`
- HasMany `billings` via `store_id`
- HasMany `users` via `store_id` (as `users`)

---

## supplier_ledger

**Model:** `SupplierLedger` · **File:** `src/modules/inventory/supplierLedger.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `ledger_number` | INTEGER | NO |  |  | Per-supplier sequence (1,2,3...) — this supplier's own ledger entry number. |
| `location_id` | CHAR(36) | YES |  | FK → locations.id | Location (branch) this row belongs to |
| `supplier_id` | CHAR(36) | NO |  | FK → suppliers.id | Supplier |
| `entry_type` | ENUM('debit', 'credit') | NO |  |  |  |
| `amount` | DECIMAL(12,2) | NO |  |  |  |
| `due_date` | DATE | YES |  |  |  |
| `paid_at` | DATETIME | YES |  |  |  |
| `stock_movement_id` | CHAR(36) | YES |  | FK → stock_movements.id |  |
| `note` | TEXT | YES |  |  | Free-text note |
| `created_by` | CHAR(36) | YES |  | FK → users.id | User who created it |
| `is_pos_visible` | TINYINT(1) | NO | true |  | Shown on the POS |
| `is_web_visible` | TINYINT(1) | NO | true |  | Shown on the web store |
| `channel` | ENUM('web', 'pos', 'both') | NO | both |  | Where it belongs / was made: web, pos (or both) |
| `created_at` | DATETIME | NO |  |  | When the row was created |

**Indexes**

- UNIQUE (supplier_id, ledger_number)

**Relations**

- BelongsTo `suppliers` via `supplier_id`
- BelongsTo `stores` via `store_id`
- BelongsTo `locations` via `location_id`
- BelongsTo `users` via `created_by` (as `createdBy`)
- BelongsTo `stock_movements` via `stock_movement_id`

---

## supplier_locations

**Model:** `SupplierLocation` · **File:** `src/modules/inventory/supplierLocation.model.js`

A branch a supplier delivers to (used when suppliers.location_scope is "selected").

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  |  | Store this row belongs to |
| `supplier_location_number` | INTEGER | NO |  |  | Per-supplier sequence (1,2,3...) over this supplier's current set of serviced locations. |
| `supplier_id` | CHAR(36) | NO |  | FK → suppliers.id | Supplier |
| `location_id` | CHAR(36) | NO |  | FK → locations.id | Location (branch) this row belongs to |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (supplier_id, supplier_location_number)

**Relations**

- BelongsTo `suppliers` via `supplier_id`
- BelongsTo `locations` via `location_id`

---

## suppliers

**Model:** `Supplier` · **File:** `src/modules/inventory/supplier.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `supplier_number` | INTEGER | NO |  |  |  |
| `name` | TEXT | NO |  |  | Name |
| `phone` | VARCHAR(64) | YES |  |  |  |
| `email` | VARCHAR(255) | YES |  |  |  |
| `address` | TEXT | YES |  |  |  |
| `payment_terms` | TEXT | YES |  |  |  |
| `location_scope` | ENUM('all', 'selected') | NO | all |  |  |
| `is_active` | TINYINT(1) | NO | true |  | false = disabled (kept for history) |
| `is_pos_visible` | TINYINT(1) | NO | true |  | Shown on the POS |
| `is_web_visible` | TINYINT(1) | NO | true |  | Shown on the web store |
| `channel` | ENUM('web', 'pos', 'both') | NO | both |  | Where it belongs / was made: web, pos (or both) |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (store_id, supplier_number)

**Relations**

- BelongsTo `stores` via `store_id`
- HasMany `supplier_ledger` via `supplier_id`
- HasMany `supplier_locations` via `supplier_id` (as `supplierLocations`)

---

## users

**Model:** `User` · **File:** `src/modules/auth/user.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | YES |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | YES |  |  | Store number (short id) |
| `user_number` | INTEGER | YES |  |  | Per-store sequence (1,2,3...); null for superadmins, who have no store_id. |
| `location_id` | CHAR(36) | YES |  | FK → locations.id | Location (branch) this row belongs to |
| `location_id_int` | INTEGER | YES |  |  | Location number (short id) |
| `name` | TEXT | NO |  |  | Name |
| `email` | VARCHAR(255) | NO |  |  |  |
| `password` | TEXT | NO |  |  |  |
| `pin` | VARCHAR(32) | YES |  |  |  |
| `phone` | VARCHAR(64) | YES |  |  |  |
| `role` | ENUM('superadmin', 'store_admin', 'manager', 'cashier', 'customer') | NO |  |  |  |
| `is_verified` | TINYINT(1) | NO | true |  |  |
| `is_active` | TINYINT(1) | NO | true |  | false = disabled (kept for history) |
| `last_login_at` | DATETIME | YES |  |  |  |
| `refresh_token_hash` | TEXT | YES |  |  |  |
| `token_version` | INTEGER | NO | 0 |  |  |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (store_id, user_number)
- UNIQUE (store_id, email)
- UNIQUE (store_id, location_id, pin)
- (store_id, role)
- (store_id, location_id)

**Relations**

- HasOne `stores` via `admin_id` (as `administeredStore`)
- BelongsTo `stores` via `store_id` (as `store`)
- BelongsTo `locations` via `location_id`
- HasMany `auth_tokens` via `user_id`

---

## website_content

**Model:** `WebsiteContent` · **File:** `src/modules/stores/websiteContent.model.js`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID v4 | PK | Row id (UUID) |
| `store_id` | CHAR(36) | NO |  | FK → stores.id | Store this row belongs to |
| `store_id_int` | INTEGER | NO |  |  | Store number (short id) |
| `homepage_headline` | TEXT | YES |  |  |  |
| `homepage_headline` | TEXT | YES |  |  |  |
| `homepage_headline` | TEXT | YES |  |  |  |
| `homepage_headline` | TEXT | YES |  |  |  |
| `homepage_headline` | TEXT | YES |  |  |  |
| `homepage_headline` | TEXT | YES |  |  |  |
| `homepage_headline` | TEXT | YES |  |  |  |
| `homepage_headline` | TEXT | YES |  |  |  |
| `homepage_headline` | TEXT | YES |  |  |  |
| `homepage_headline` | TEXT | YES |  |  |  |
| `homepage_headline` | TEXT | YES |  |  |  |
| `homepage_headline` | TEXT | YES |  |  |  |
| `homepage_headline` | TEXT | YES |  |  |  |
| `created_at` | DATETIME | NO |  |  | When the row was created |
| `updated_at` | DATETIME | NO |  |  | When the row last changed |

**Indexes**

- UNIQUE (store_id)

**Relations**

- BelongsTo `stores` via `store_id`
