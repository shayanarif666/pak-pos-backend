export const name = "20260904120000-schema-v2"

const TS = `created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`
const CREATED = `created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)`

const DROP_TABLES = [
  "audit_logs",
  "store_backups",
  "reviews",
  "stock_transfers",
  "stock_movements",
  "receipts",
  "payments",
  "order_items",
  "orders",
  "approval_requests",
  "register_sessions",
  "coupon_redemptions",
  "coupons",
  "offer_targets",
  "offers",
  "addresses",
  "cart_items",
  "carts",
  "customer_credit_entries",
  "customers",
  "supplier_ledger",
  "suppliers",
  "product_bulk_tiers",
  "product_stocks",
  "products",
  "categories",
  "payment_method_tax_rates",
  "shipping_rules",
  "store_banners",
  "website_content",
  "store_themes",
  "pos_devices",
  "billings",
  "store_licenses",
  "auth_tokens",
  "pos_staff",
  "wishlist_products",
  "wishlists",
  "stock_adjustments",
  "users",
  "locations",
  "stores",
  "plans",
  "counters",
]

const PLAN_CODE = "ENUM('package_1','package_2','package_3')"
const BUSINESS_TYPE = "ENUM('grocery','boutique','retail','pharmacy')"
const LICENSE_STATUS = "ENUM('active','expired','revoked')"
const USER_ROLE =
  "ENUM('superadmin','store_admin','manager','cashier','customer')"
const AUTH_TOKEN_TYPE = "ENUM('email_verify','password_reset')"
const BILLING_STATUS = "ENUM('pending','paid','failed','refunded')"
const ORDER_CHANNEL = "ENUM('web','pos')"
const ORDER_STATUS =
  "ENUM('pending','completed','voided','cancelled','refunded')"
const ORDER_PAYMENT_STATUS = "ENUM('pending','paid','failed','refunded')"
const PAYMENT_METHOD =
  "ENUM('cash','card','jazzcash','easypaisa','cod','mixed')"
const PAYMENT_ROW_STATUS = "ENUM('initiated','success','failed')"
const DISCOUNT_TYPE = "ENUM('percentage','fixed')"
const TAX_AMOUNT_TYPE = "ENUM('percentage','fixed')"
const PRODUCT_UNIT = "ENUM('piece','kg','gram','liter','packet','box')"
const OFFER_TYPE = "ENUM('flash_sale','bulk_discount','bogo','promotional')"
const OFFER_APPLY_TO = "ENUM('product','category')"
const STOCK_MOVEMENT_TYPE =
  "ENUM('stock_in','stock_out','adjustment','sale','refund','transfer_out','transfer_in','custom_sale')"
const STOCK_MOVEMENT_REASON =
  "ENUM('purchase','opening_balance','return_to_supplier','customer_return','waste','damage','expiry','theft','count','sale','refund','sync','transfer','custom_sale','other')"
const REGISTER_SESSION_STATUS = "ENUM('clock_in','clock_out')"
const APPROVAL_STATUS = "ENUM('pending','approved','rejected')"
const APPROVAL_TYPE =
  "ENUM('void_order','cancel_order','pin_override','stock_adjustment','discount_override')"
const REVIEW_STATUS = "ENUM('pending','approved','rejected')"
const AUDIT_ACTOR_TYPE = "ENUM('user','system')"
const AUDIT_ACTION =
  "ENUM('create','update','delete','login','logout','clock_in','clock_out','sale','void','cancel','refund','pin_override','approve','reject','license_activate','backup','restore')"
const TRANSFER_STATUS = "ENUM('pending','completed','cancelled')"
const LEDGER_ENTRY_TYPE = "ENUM('debit','credit')"

const createStatements = [
  `CREATE TABLE plans (
    id CHAR(36) NOT NULL,
    code ${PLAN_CODE} NOT NULL,
    name VARCHAR(255) NOT NULL,
    price_pkr DECIMAL(12,2) NOT NULL,
    max_devices INT NOT NULL,
    max_locations INT NOT NULL,
    offline_enabled TINYINT(1) NOT NULL DEFAULT 0,
    pin_override_enabled TINYINT(1) NOT NULL DEFAULT 0,
    approval_enabled TINYINT(1) NOT NULL DEFAULT 0,
    advanced_reports TINYINT(1) NOT NULL DEFAULT 0,
    backup_restore_enabled TINYINT(1) NOT NULL DEFAULT 0,
    multi_branch_enabled TINYINT(1) NOT NULL DEFAULT 0,
    has_dedicated_am TINYINT(1) NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    ${TS},
    PRIMARY KEY (id),
    UNIQUE KEY plans_code_unique (code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE counters (
    name VARCHAR(191) NOT NULL,
    seq INT NOT NULL DEFAULT 0,
    PRIMARY KEY (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE stores (
    id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    plan_id CHAR(36) NOT NULL,
    name TEXT NOT NULL,
    slug VARCHAR(255) NOT NULL,
    legal_name VARCHAR(255) NULL,
    owner_name VARCHAR(255) NULL,
    business_type ${BUSINESS_TYPE} NOT NULL,
    address TEXT NOT NULL,
    city VARCHAR(255) NULL,
    contact_email VARCHAR(255) NOT NULL,
    contact_phone VARCHAR(255) NOT NULL,
    logo_url TEXT NULL,
    favicon_url TEXT NULL,
    currency VARCHAR(16) NOT NULL DEFAULT 'PKR',
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Karachi',
    ntn VARCHAR(255) NULL,
    strn VARCHAR(255) NULL,
    fbr_invoice_enabled TINYINT(1) NOT NULL DEFAULT 0,
    charge_tax_on_sales TINYINT(1) NOT NULL DEFAULT 0,
    default_tax_rate DECIMAL(5,2) NULL,
    expiry_warning_days INT NOT NULL DEFAULT 30,
    expiry_critical_days INT NOT NULL DEFAULT 7,
    receipt_footer TEXT NULL,
    pos_enabled TINYINT(1) NOT NULL DEFAULT 1,
    web_enabled TINYINT(1) NOT NULL DEFAULT 1,
    admin_id CHAR(36) NULL,
    default_location_id CHAR(36) NULL,
    default_location_id_int INT NULL,
    account_manager_name VARCHAR(255) NULL,
    account_manager_phone VARCHAR(255) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    is_live TINYINT(1) NOT NULL DEFAULT 0,
    suspend_reason TEXT NULL,
    ${TS},
    PRIMARY KEY (id),
    UNIQUE KEY stores_store_id_int_unique (store_id_int),
    UNIQUE KEY stores_slug_unique (slug),
    CONSTRAINT stores_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES plans (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE locations (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id_int INT NOT NULL,
    name TEXT NOT NULL,
    address_line TEXT NOT NULL,
    city TEXT NOT NULL,
    country VARCHAR(8) NULL DEFAULT 'PK',
    postal_code VARCHAR(32) NULL,
    phone VARCHAR(64) NULL,
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    ${TS},
    PRIMARY KEY (id),
    UNIQUE KEY locations_store_id_location_id_int_unique (store_id, location_id_int),
    CONSTRAINT locations_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE users (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NULL,
    store_id_int INT NULL,
    location_id CHAR(36) NULL,
    location_id_int INT NULL,
    name TEXT NOT NULL,
    email VARCHAR(255) NOT NULL,
    password TEXT NOT NULL,
    pin VARCHAR(32) NULL,
    phone VARCHAR(64) NULL,
    role ${USER_ROLE} NOT NULL,
    is_verified TINYINT(1) NOT NULL DEFAULT 1,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    last_login_at DATETIME(6) NULL,
    refresh_token_hash TEXT NULL,
    ${TS},
    PRIMARY KEY (id),
    UNIQUE KEY users_store_id_email_unique (store_id, email),
    UNIQUE KEY users_store_id_pin_unique (store_id, pin),
    KEY users_store_id_role (store_id, role),
    KEY users_store_id_location_id (store_id, location_id),
    CONSTRAINT users_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE SET NULL,
    CONSTRAINT users_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE auth_tokens (
    id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    type ${AUTH_TOKEN_TYPE} NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    used_at DATETIME(6) NULL,
    ${CREATED},
    PRIMARY KEY (id),
    CONSTRAINT auth_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE store_licenses (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    plan_id CHAR(36) NOT NULL,
    license_key VARCHAR(255) NOT NULL,
    status ${LICENSE_STATUS} NOT NULL DEFAULT 'active',
    starts_at DATETIME(6) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    revoked_at DATETIME(6) NULL,
    revoked_reason TEXT NULL,
    ${TS},
    PRIMARY KEY (id),
    UNIQUE KEY store_licenses_license_key_unique (license_key),
    KEY store_licenses_status_expires_at (status, expires_at),
    CONSTRAINT store_licenses_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT store_licenses_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES plans (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE billings (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    plan_id CHAR(36) NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(16) NOT NULL DEFAULT 'PKR',
    status ${BILLING_STATUS} NOT NULL DEFAULT 'pending',
    period_start DATETIME(6) NOT NULL,
    period_end DATETIME(6) NOT NULL,
    paid_at DATETIME(6) NULL,
    method_note VARCHAR(255) NULL,
    note TEXT NULL,
    created_by CHAR(36) NULL,
    ${TS},
    PRIMARY KEY (id),
    CONSTRAINT billings_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT billings_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES plans (id),
    CONSTRAINT billings_created_by_fkey FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE pos_devices (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NOT NULL,
    location_id_int INT NOT NULL,
    device_uid VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    platform VARCHAR(255) NULL,
    app_version VARCHAR(255) NULL,
    last_seen_at DATETIME(6) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    ${TS},
    PRIMARY KEY (id),
    UNIQUE KEY pos_devices_store_id_device_uid_unique (store_id, device_uid),
    CONSTRAINT pos_devices_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT pos_devices_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE store_themes (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    \`primary\` TEXT NOT NULL,
    secondary TEXT NOT NULL,
    accent TEXT NOT NULL,
    btn_filled_bg TEXT NULL,
    btn_filled_text TEXT NULL,
    btn_filled_hover TEXT NULL,
    btn_outline_border TEXT NULL,
    btn_outline_text TEXT NULL,
    btn_outline_hover TEXT NULL,
    btn_text_color TEXT NULL,
    btn_text_hover TEXT NULL,
    ${TS},
    PRIMARY KEY (id),
    UNIQUE KEY store_themes_store_id_unique (store_id),
    CONSTRAINT store_themes_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE website_content (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    homepage_headline TEXT NULL,
    homepage_subheadline TEXT NULL,
    about_title TEXT NULL,
    about_body TEXT NULL,
    about_mission TEXT NULL,
    about_vision TEXT NULL,
    contact_title TEXT NULL,
    contact_body TEXT NULL,
    faq_body TEXT NULL,
    shipping_body TEXT NULL,
    terms_body TEXT NULL,
    privacy_body TEXT NULL,
    footer_text TEXT NULL,
    ${TS},
    PRIMARY KEY (id),
    UNIQUE KEY website_content_store_id_unique (store_id),
    CONSTRAINT website_content_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE store_banners (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    image_url TEXT NOT NULL,
    heading TEXT NULL,
    link_url TEXT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    ${TS},
    PRIMARY KEY (id),
    CONSTRAINT store_banners_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE shipping_rules (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    flat_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
    free_over_amount DECIMAL(12,2) NULL,
    ${TS},
    PRIMARY KEY (id),
    UNIQUE KEY shipping_rules_store_id_unique (store_id),
    CONSTRAINT shipping_rules_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE payment_method_tax_rates (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    payment_method ${PAYMENT_METHOD} NOT NULL,
    gst_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
    ${TS},
    PRIMARY KEY (id),
    UNIQUE KEY payment_method_tax_rates_store_method_unique (store_id, payment_method),
    CONSTRAINT payment_method_tax_rates_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE categories (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    name TEXT NOT NULL,
    slug VARCHAR(255) NOT NULL,
    parent_category_id CHAR(36) NULL,
    image_url TEXT NULL,
    description TEXT NULL,
    tax_type ${TAX_AMOUNT_TYPE} NULL,
    tax_value DECIMAL(12,2) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    pos_visible TINYINT(1) NOT NULL DEFAULT 1,
    web_visible TINYINT(1) NOT NULL DEFAULT 1,
    ${TS},
    PRIMARY KEY (id),
    UNIQUE KEY categories_store_id_slug_unique (store_id, slug),
    CONSTRAINT categories_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT categories_parent_category_id_fkey FOREIGN KEY (parent_category_id) REFERENCES categories (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE products (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    category_id CHAR(36) NOT NULL,
    title TEXT NOT NULL,
    slug VARCHAR(255) NOT NULL,
    sku VARCHAR(255) NOT NULL,
    barcode VARCHAR(255) NULL,
    image_url TEXT NULL,
    description TEXT NULL,
    unit ${PRODUCT_UNIT} NOT NULL DEFAULT 'piece',
    cost_price DECIMAL(12,2) NOT NULL,
    selling_price DECIMAL(12,2) NOT NULL,
    has_product_discount TINYINT(1) NOT NULL DEFAULT 0,
    discount_type ${DISCOUNT_TYPE} NULL,
    discount_value DECIMAL(12,2) NULL,
    tax_type ${TAX_AMOUNT_TYPE} NULL,
    tax_value DECIMAL(12,2) NULL,
    is_pack_product TINYINT(1) NOT NULL DEFAULT 0,
    pack_size INT NULL,
    sell_loose TINYINT(1) NOT NULL DEFAULT 0,
    is_weight_based TINYINT(1) NOT NULL DEFAULT 0,
    has_bulk_discount TINYINT(1) NOT NULL DEFAULT 0,
    expiry_date DATE NULL,
    low_stock_threshold DECIMAL(12,4) NOT NULL DEFAULT 10,
    is_published TINYINT(1) NOT NULL DEFAULT 0,
    pos_visible TINYINT(1) NOT NULL DEFAULT 1,
    web_visible TINYINT(1) NOT NULL DEFAULT 1,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    ${TS},
    PRIMARY KEY (id),
    UNIQUE KEY products_store_id_sku_unique (store_id, sku),
    UNIQUE KEY products_store_id_slug_unique (store_id, slug),
    UNIQUE KEY products_store_id_barcode_unique (store_id, barcode),
    KEY products_store_id_is_published (store_id, is_published),
    KEY products_store_id_category_id (store_id, category_id),
    CONSTRAINT products_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE product_stocks (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NOT NULL,
    location_id_int INT NOT NULL,
    product_id CHAR(36) NOT NULL,
    qty DECIMAL(12,4) NOT NULL DEFAULT 0,
    low_stock_threshold DECIMAL(12,4) NULL,
    ${TS},
    PRIMARY KEY (id),
    UNIQUE KEY product_stocks_location_id_product_id_unique (location_id, product_id),
    KEY product_stocks_store_id_location_id (store_id, location_id),
    KEY product_stocks_location_id_qty (location_id, qty),
    CONSTRAINT product_stocks_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT product_stocks_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE,
    CONSTRAINT product_stocks_product_id_fkey FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE product_bulk_tiers (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    product_id CHAR(36) NOT NULL,
    min_qty DECIMAL(12,4) NOT NULL,
    discount_type ${DISCOUNT_TYPE} NOT NULL,
    discount_value DECIMAL(12,2) NOT NULL,
    ${TS},
    PRIMARY KEY (id),
    UNIQUE KEY product_bulk_tiers_product_id_min_qty_unique (product_id, min_qty),
    CONSTRAINT product_bulk_tiers_product_id_fkey FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
    CONSTRAINT product_bulk_tiers_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE suppliers (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    name TEXT NOT NULL,
    phone VARCHAR(64) NULL,
    email VARCHAR(255) NULL,
    address TEXT NULL,
    payment_terms TEXT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    ${TS},
    PRIMARY KEY (id),
    CONSTRAINT suppliers_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE supplier_ledger (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NULL,
    supplier_id CHAR(36) NOT NULL,
    entry_type ${LEDGER_ENTRY_TYPE} NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    due_date DATE NULL,
    paid_at DATETIME(6) NULL,
    stock_movement_id CHAR(36) NULL,
    note TEXT NULL,
    created_by CHAR(36) NULL,
    ${CREATED},
    PRIMARY KEY (id),
    CONSTRAINT supplier_ledger_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT supplier_ledger_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT,
    CONSTRAINT supplier_ledger_created_by_fkey FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT supplier_ledger_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE customers (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NULL,
    user_id CHAR(36) NULL,
    name TEXT NOT NULL,
    email VARCHAR(255) NULL,
    phone VARCHAR(64) NULL,
    credit_limit DECIMAL(12,2) NULL,
    credit_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    ${TS},
    PRIMARY KEY (id),
    KEY customers_store_id_phone (store_id, phone),
    CONSTRAINT customers_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT customers_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT customers_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE customer_credit_entries (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    customer_id CHAR(36) NOT NULL,
    order_id CHAR(36) NULL,
    entry_type ${LEDGER_ENTRY_TYPE} NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    due_date DATE NULL,
    note TEXT NULL,
    created_by CHAR(36) NULL,
    ${CREATED},
    PRIMARY KEY (id),
    CONSTRAINT customer_credit_entries_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
    CONSTRAINT customer_credit_entries_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT customer_credit_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE carts (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    user_id CHAR(36) NOT NULL,
    coupon_code VARCHAR(64) NULL,
    ${TS},
    PRIMARY KEY (id),
    UNIQUE KEY carts_store_id_user_id_unique (store_id, user_id),
    CONSTRAINT carts_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT carts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE cart_items (
    id CHAR(36) NOT NULL,
    cart_id CHAR(36) NOT NULL,
    product_id CHAR(36) NOT NULL,
    quantity DECIMAL(12,4) NOT NULL DEFAULT 1,
    weight DECIMAL(12,4) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY cart_items_cart_id_product_id_unique (cart_id, product_id),
    CONSTRAINT cart_items_cart_id_fkey FOREIGN KEY (cart_id) REFERENCES carts (id) ON DELETE CASCADE,
    CONSTRAINT cart_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE addresses (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    user_id CHAR(36) NOT NULL,
    name TEXT NOT NULL,
    phone VARCHAR(64) NOT NULL,
    address_line TEXT NOT NULL,
    city TEXT NOT NULL,
    postal_code VARCHAR(32) NULL,
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    ${TS},
    PRIMARY KEY (id),
    CONSTRAINT addresses_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT addresses_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE offers (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NULL,
    name TEXT NOT NULL,
    type ${OFFER_TYPE} NOT NULL,
    apply_to ${OFFER_APPLY_TO} NOT NULL,
    discount_type ${DISCOUNT_TYPE} NULL,
    discount_value DECIMAL(12,2) NULL,
    min_qty DECIMAL(12,4) NULL,
    buy_qty INT NULL,
    get_qty INT NULL,
    start_at DATETIME(6) NULL,
    end_at DATETIME(6) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by CHAR(36) NULL,
    ${TS},
    PRIMARY KEY (id),
    CONSTRAINT offers_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT offers_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL,
    CONSTRAINT offers_created_by_fkey FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE offer_targets (
    id CHAR(36) NOT NULL,
    offer_id CHAR(36) NOT NULL,
    product_id CHAR(36) NULL,
    category_id CHAR(36) NULL,
    free_product_id CHAR(36) NULL,
    promo_price DECIMAL(12,2) NULL,
    PRIMARY KEY (id),
    CONSTRAINT offer_targets_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES offers (id) ON DELETE CASCADE,
    CONSTRAINT offer_targets_product_id_fkey FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
    CONSTRAINT offer_targets_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE CASCADE,
    CONSTRAINT offer_targets_free_product_id_fkey FOREIGN KEY (free_product_id) REFERENCES products (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE coupons (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NULL,
    code VARCHAR(64) NOT NULL,
    type ${DISCOUNT_TYPE} NOT NULL,
    value DECIMAL(12,2) NOT NULL,
    min_order_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    start_date DATETIME(6) NULL,
    end_date DATETIME(6) NULL,
    usage_limit INT NULL,
    used_count INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    pos_enabled TINYINT(1) NOT NULL DEFAULT 0,
    web_enabled TINYINT(1) NOT NULL DEFAULT 1,
    ${TS},
    PRIMARY KEY (id),
    UNIQUE KEY coupons_store_id_code_unique (store_id, code),
    CONSTRAINT coupons_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT coupons_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE coupon_redemptions (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    coupon_id CHAR(36) NOT NULL,
    order_id CHAR(36) NOT NULL,
    user_id CHAR(36) NULL,
    amount DECIMAL(12,2) NOT NULL,
    ${CREATED},
    PRIMARY KEY (id),
    UNIQUE KEY coupon_redemptions_coupon_id_order_id_unique (coupon_id, order_id),
    CONSTRAINT coupon_redemptions_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES coupons (id) ON DELETE RESTRICT,
    CONSTRAINT coupon_redemptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT coupon_redemptions_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE register_sessions (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NOT NULL,
    location_id_int INT NOT NULL,
    cashier_id CHAR(36) NOT NULL,
    device_id CHAR(36) NULL,
    status ${REGISTER_SESSION_STATUS} NOT NULL DEFAULT 'clock_in',
    opening_cash DECIMAL(12,2) NOT NULL,
    cash_in DECIMAL(12,2) NOT NULL DEFAULT 0,
    cash_out DECIMAL(12,2) NOT NULL DEFAULT 0,
    cash_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    card_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    jazzcash_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    easypaisa_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    net_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    expected_cash DECIMAL(12,2) NULL,
    note_5000_count INT NULL,
    note_1000_count INT NULL,
    note_500_count INT NULL,
    note_100_count INT NULL,
    note_50_count INT NULL,
    note_20_count INT NULL,
    coins_total DECIMAL(12,2) NULL,
    counted_cash DECIMAL(12,2) NULL,
    closing_cash DECIMAL(12,2) NULL,
    cash_variance DECIMAL(12,2) NULL,
    note TEXT NULL,
    opened_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    closed_at DATETIME(6) NULL,
    ${TS},
    PRIMARY KEY (id),
    KEY register_sessions_store_location_status (store_id, location_id, status),
    CONSTRAINT register_sessions_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT register_sessions_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE,
    CONSTRAINT register_sessions_device_id_fkey FOREIGN KEY (device_id) REFERENCES pos_devices (id) ON DELETE SET NULL,
    CONSTRAINT register_sessions_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE approval_requests (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    location_id CHAR(36) NOT NULL,
    type ${APPROVAL_TYPE} NOT NULL,
    status ${APPROVAL_STATUS} NOT NULL DEFAULT 'pending',
    requested_by CHAR(36) NOT NULL,
    reviewed_by CHAR(36) NULL,
    order_id CHAR(36) NULL,
    payload JSON NULL,
    reason TEXT NULL,
    review_note TEXT NULL,
    ${TS},
    PRIMARY KEY (id),
    CONSTRAINT approval_requests_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT approval_requests_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE,
    CONSTRAINT approval_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES users (id),
    CONSTRAINT approval_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES users (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE orders (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NULL,
    location_id_int INT NULL,
    channel ${ORDER_CHANNEL} NOT NULL,
    is_custom TINYINT(1) NOT NULL DEFAULT 0,
    order_number INT NOT NULL,
    cashier_id CHAR(36) NULL,
    customer_id CHAR(36) NULL,
    register_session_id CHAR(36) NULL,
    client_local_id VARCHAR(255) NULL,
    subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
    is_order_discounted TINYINT(1) NOT NULL DEFAULT 0,
    order_discount_type ${DISCOUNT_TYPE} NULL,
    discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    coupon_id CHAR(36) NULL,
    coupon_code VARCHAR(64) NULL,
    coupon_discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    shipping_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    cost_total DECIMAL(12,2) NOT NULL DEFAULT 0,
    payment_method ${PAYMENT_METHOD} NOT NULL,
    payment_status ${ORDER_PAYMENT_STATUS} NOT NULL DEFAULT 'pending',
    shipping_address TEXT NULL,
    order_status ${ORDER_STATUS} NOT NULL DEFAULT 'pending',
    amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
    change_due DECIMAL(12,2) NULL,
    void_reason TEXT NULL,
    voided_by CHAR(36) NULL,
    cancel_reason TEXT NULL,
    cancelled_by CHAR(36) NULL,
    placed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    synced_at DATETIME(6) NULL,
    ${TS},
    PRIMARY KEY (id),
    UNIQUE KEY orders_store_id_order_number_unique (store_id, order_number),
    UNIQUE KEY orders_store_id_client_local_id_unique (store_id, client_local_id),
    KEY orders_store_id_placed_at (store_id, placed_at),
    KEY orders_store_location_channel_status (store_id, location_id, channel, order_status),
    CONSTRAINT orders_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT orders_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL,
    CONSTRAINT orders_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL,
    CONSTRAINT orders_register_session_id_fkey FOREIGN KEY (register_session_id) REFERENCES register_sessions (id) ON DELETE SET NULL,
    CONSTRAINT orders_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES coupons (id) ON DELETE SET NULL,
    CONSTRAINT orders_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT orders_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE order_items (
    id CHAR(36) NOT NULL,
    order_id CHAR(36) NOT NULL,
    product_id CHAR(36) NULL,
    title TEXT NOT NULL,
    sku VARCHAR(255) NULL,
    barcode VARCHAR(255) NULL,
    unit ${PRODUCT_UNIT} NULL,
    is_weight_based TINYINT(1) NOT NULL DEFAULT 0,
    weight DECIMAL(12,4) NULL,
    qty_packs DECIMAL(12,4) NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    cost_price DECIMAL(12,2) NOT NULL DEFAULT 0,
    quantity DECIMAL(12,4) NOT NULL,
    discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    subtotal DECIMAL(12,2) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
    CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE payments (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NULL,
    location_id_int INT NULL,
    order_id CHAR(36) NOT NULL,
    method ${PAYMENT_METHOD} NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    currency VARCHAR(16) NOT NULL DEFAULT 'PKR',
    status ${PAYMENT_ROW_STATUS} NOT NULL DEFAULT 'initiated',
    gateway_transaction_id VARCHAR(255) NULL,
    idempotency_key VARCHAR(255) NULL,
    raw_payload JSON NULL,
    paid_at DATETIME(6) NULL,
    failure_reason TEXT NULL,
    ${TS},
    PRIMARY KEY (id),
    UNIQUE KEY payments_store_id_gateway_txn_unique (store_id, gateway_transaction_id),
    CONSTRAINT payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE RESTRICT,
    CONSTRAINT payments_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT payments_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE receipts (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NULL,
    location_id_int INT NULL,
    order_id CHAR(36) NOT NULL,
    payment_id CHAR(36) NULL,
    receipt_number INT NOT NULL,
    cashier_id CHAR(36) NULL,
    subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    shipping_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    issued_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    ${TS},
    PRIMARY KEY (id),
    UNIQUE KEY receipts_store_id_receipt_number_unique (store_id, receipt_number),
    CONSTRAINT receipts_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE RESTRICT,
    CONSTRAINT receipts_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT receipts_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL,
    CONSTRAINT receipts_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE stock_movements (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NOT NULL,
    location_id_int INT NOT NULL,
    product_id CHAR(36) NOT NULL,
    movement_type ${STOCK_MOVEMENT_TYPE} NOT NULL,
    reason ${STOCK_MOVEMENT_REASON} NOT NULL,
    reason_note TEXT NULL,
    qty DECIMAL(12,4) NOT NULL,
    qty_after DECIMAL(12,4) NULL,
    supplier_id CHAR(36) NULL,
    staff_id CHAR(36) NULL,
    order_id CHAR(36) NULL,
    ${CREATED},
    PRIMARY KEY (id),
    KEY stock_movements_store_product_created (store_id, product_id, created_at),
    CONSTRAINT stock_movements_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT stock_movements_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE,
    CONSTRAINT stock_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
    CONSTRAINT stock_movements_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE SET NULL,
    CONSTRAINT stock_movements_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT stock_movements_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE stock_transfers (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    from_location_id CHAR(36) NOT NULL,
    to_location_id CHAR(36) NOT NULL,
    product_id CHAR(36) NOT NULL,
    qty DECIMAL(12,4) NOT NULL,
    status ${TRANSFER_STATUS} NOT NULL DEFAULT 'pending',
    note TEXT NULL,
    created_by CHAR(36) NULL,
    ${TS},
    PRIMARY KEY (id),
    CONSTRAINT stock_transfers_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT stock_transfers_from_location_id_fkey FOREIGN KEY (from_location_id) REFERENCES locations (id) ON DELETE RESTRICT,
    CONSTRAINT stock_transfers_to_location_id_fkey FOREIGN KEY (to_location_id) REFERENCES locations (id) ON DELETE RESTRICT,
    CONSTRAINT stock_transfers_product_id_fkey FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
    CONSTRAINT stock_transfers_created_by_fkey FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE reviews (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    product_id CHAR(36) NOT NULL,
    user_id CHAR(36) NULL,
    rating INT NOT NULL,
    comment TEXT NULL,
    status ${REVIEW_STATUS} NOT NULL DEFAULT 'pending',
    reviewed_by CHAR(36) NULL,
    reviewed_at DATETIME(6) NULL,
    ${TS},
    PRIMARY KEY (id),
    UNIQUE KEY reviews_user_id_product_id_unique (user_id, product_id),
    CONSTRAINT reviews_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT reviews_product_id_fkey FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
    CONSTRAINT reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT reviews_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE store_backups (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    file_url TEXT NULL,
    note TEXT NULL,
    created_by CHAR(36) NULL,
    ${CREATED},
    PRIMARY KEY (id),
    CONSTRAINT store_backups_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT store_backups_created_by_fkey FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE audit_logs (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NULL,
    store_id_int INT NULL,
    location_id CHAR(36) NULL,
    location_id_int INT NULL,
    device_id CHAR(36) NULL,
    actor_type ${AUDIT_ACTOR_TYPE} NOT NULL,
    user_id CHAR(36) NULL,
    action ${AUDIT_ACTION} NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id CHAR(36) NULL,
    before_data JSON NULL,
    after_data JSON NULL,
    channel VARCHAR(32) NULL,
    ip_address VARCHAR(64) NULL,
    user_agent TEXT NULL,
    note TEXT NULL,
    ${CREATED},
    PRIMARY KEY (id),
    KEY audit_logs_store_id_created_at (store_id, created_at),
    KEY audit_logs_store_entity (store_id, entity_type(64), entity_id),
    CONSTRAINT audit_logs_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT audit_logs_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL,
    CONSTRAINT audit_logs_device_id_fkey FOREIGN KEY (device_id) REFERENCES pos_devices (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
]

const circularFks = [
  `ALTER TABLE stores
    ADD CONSTRAINT stores_admin_id_fkey
    FOREIGN KEY (admin_id) REFERENCES users (id) ON DELETE SET NULL`,
  `ALTER TABLE stores
    ADD CONSTRAINT stores_default_location_id_fkey
    FOREIGN KEY (default_location_id) REFERENCES locations (id) ON DELETE SET NULL`,
  `ALTER TABLE receipts
    ADD CONSTRAINT receipts_payment_id_fkey
    FOREIGN KEY (payment_id) REFERENCES payments (id) ON DELETE SET NULL`,
  `ALTER TABLE customer_credit_entries
    ADD CONSTRAINT customer_credit_entries_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL`,
  `ALTER TABLE coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE`,
  `ALTER TABLE approval_requests
    ADD CONSTRAINT approval_requests_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL`,
]

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize

  await sequelize.query("SET FOREIGN_KEY_CHECKS = 0")
  try {
    for (const table of DROP_TABLES) {
      await sequelize.query(`DROP TABLE IF EXISTS \`${table}\``)
    }
  } finally {
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 1")
  }

  for (const sql of createStatements) {
    await sequelize.query(sql)
  }

  for (const sql of circularFks) {
    await sequelize.query(sql)
  }
}
