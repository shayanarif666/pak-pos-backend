export const name = "20260830120000-init-schema"

const statements = [
  `CREATE TABLE counters (
    name VARCHAR(191) NOT NULL,
    seq INT NOT NULL DEFAULT 0,
    PRIMARY KEY (name)
  ) ENGINE=InnoDB`,

  `CREATE TABLE stores (
    id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL AUTO_INCREMENT,
    name TEXT NOT NULL,
    slug VARCHAR(255) NOT NULL,
    custom_domain VARCHAR(255) NULL,
    address TEXT NOT NULL,
    contact_email VARCHAR(255) NOT NULL,
    contact_phone VARCHAR(255) NOT NULL,
    logo_url TEXT NULL,
    favicon_url TEXT NULL,
    currency VARCHAR(16) NOT NULL DEFAULT 'PKR',
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Karachi',
    pos_enabled TINYINT(1) NOT NULL DEFAULT 1,
    web_enabled TINYINT(1) NOT NULL DEFAULT 1,
    owner_id CHAR(36) NULL,
    location_id CHAR(36) NULL,
    location_id_int INT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    is_live TINYINT(1) NOT NULL DEFAULT 1,
    onboarding_completed TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY stores_store_id_int_unique (store_id_int),
    UNIQUE KEY stores_slug_unique (slug)
  ) ENGINE=InnoDB`,

  `CREATE TABLE store_themes (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    \`primary\` TEXT NOT NULL,
    secondary TEXT NOT NULL,
    accent TEXT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    CONSTRAINT store_themes_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE website_content (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    about_title TEXT NULL,
    about_body TEXT NULL,
    about_mission TEXT NULL,
    about_vision TEXT NULL,
    contact_title TEXT NULL,
    contact_body TEXT NULL,
    homepage_headline TEXT NULL,
    homepage_subheadline TEXT NULL,
    footer_text TEXT NULL,
    faq_body TEXT NULL,
    shipping_body TEXT NULL,
    terms_body TEXT NULL,
    privacy_body TEXT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    CONSTRAINT website_content_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE shipping_rules (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    flat_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
    free_over_amount DECIMAL(12,2) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    CONSTRAINT shipping_rules_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE locations (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id_int INT NOT NULL,
    name TEXT NOT NULL,
    address_line TEXT NOT NULL,
    city TEXT NOT NULL,
    postal_code VARCHAR(32) NULL,
    phone VARCHAR(64) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY locations_store_location_unique (store_id, location_id_int),
    CONSTRAINT locations_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `ALTER TABLE stores
    ADD CONSTRAINT stores_location_id_fkey
    FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL`,

  `CREATE TABLE users (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NULL,
    store_id_int INT NULL,
    location_id CHAR(36) NULL,
    location_id_int INT NULL,
    name TEXT NOT NULL,
    email VARCHAR(255) NOT NULL,
    password TEXT NOT NULL,
    phone VARCHAR(64) NULL,
    role ENUM('superadmin','manager','cashier','customer') NOT NULL,
    is_verified TINYINT(1) NOT NULL DEFAULT 1,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    refresh_token_hash TEXT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY users_email_unique (email),
    CONSTRAINT users_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE SET NULL,
    CONSTRAINT users_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL
  ) ENGINE=InnoDB`,

  `ALTER TABLE stores
    ADD CONSTRAINT stores_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE SET NULL`,

  `CREATE TABLE pos_staff (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NULL,
    location_id_int INT NULL,
    name TEXT NOT NULL,
    username VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    pin VARCHAR(32) NOT NULL,
    role ENUM('manager','cashier') NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by CHAR(36) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    CONSTRAINT pos_staff_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT pos_staff_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL,
    CONSTRAINT pos_staff_created_by_fkey FOREIGN KEY (created_by) REFERENCES pos_staff (id) ON DELETE SET NULL
  ) ENGINE=InnoDB`,

  `CREATE TABLE register_sessions (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NOT NULL,
    location_id_int INT NOT NULL,
    cashier_id CHAR(36) NOT NULL,
    status ENUM('clock_in','clock_out') NOT NULL DEFAULT 'clock_in',
    opening_cash DECIMAL(12,2) NOT NULL,
    cash_in DECIMAL(12,2) NOT NULL DEFAULT 0,
    cash_out DECIMAL(12,2) NOT NULL DEFAULT 0,
    cash_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    card_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    expected_cash DECIMAL(12,2) GENERATED ALWAYS AS (opening_cash + cash_in + cash_sales - cash_out) STORED,
    closing_cash DECIMAL(12,2) NULL,
    \`difference\` DECIMAL(12,2) GENERATED ALWAYS AS (
      CASE
        WHEN closing_cash IS NULL THEN NULL
        ELSE closing_cash - (opening_cash + cash_in + cash_sales - cash_out)
      END
    ) STORED,
    note TEXT NULL,
    opened_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    closed_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    CONSTRAINT register_sessions_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT register_sessions_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE,
    CONSTRAINT register_sessions_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES pos_staff (id) ON DELETE RESTRICT,
    CONSTRAINT register_sessions_status_chk CHECK (
      (status = 'clock_in' AND closed_at IS NULL AND closing_cash IS NULL)
      OR (status = 'clock_out' AND closed_at IS NOT NULL)
    ),
    CONSTRAINT register_sessions_amounts_chk CHECK (
      opening_cash >= 0 AND cash_in >= 0 AND cash_out >= 0 AND cash_sales >= 0 AND card_sales >= 0
    )
  ) ENGINE=InnoDB`,

  `CREATE TABLE categories (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NULL,
    location_id_int INT NULL,
    name TEXT NOT NULL,
    slug VARCHAR(255) NOT NULL,
    parent_category_id CHAR(36) NULL,
    image_url TEXT NULL,
    description TEXT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    pos_visible TINYINT(1) NOT NULL DEFAULT 1,
    web_visible TINYINT(1) NOT NULL DEFAULT 1,
    source ENUM('web','pos','sync') NOT NULL DEFAULT 'web',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    CONSTRAINT categories_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT categories_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL,
    CONSTRAINT categories_parent_fkey FOREIGN KEY (parent_category_id) REFERENCES categories (id) ON DELETE SET NULL
  ) ENGINE=InnoDB`,

  `CREATE TABLE products (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NOT NULL,
    location_id_int INT NOT NULL,
    category_id CHAR(36) NOT NULL,
    title TEXT NOT NULL,
    slug VARCHAR(255) NOT NULL,
    sku VARCHAR(255) NOT NULL,
    barcode VARCHAR(255) NULL,
    description TEXT NULL,
    images JSON NOT NULL,
    colors JSON NOT NULL,
    sizes JSON NOT NULL,
    price DECIMAL(12,2) NOT NULL,
    pack_price DECIMAL(12,2) NULL,
    discount_price DECIMAL(12,2) NULL,
    tax_rate DECIMAL(5,2) NULL,
    currency VARCHAR(16) NOT NULL DEFAULT 'PKR',
    low_stock_threshold INT NOT NULL DEFAULT 0,
    is_pack_product TINYINT(1) NOT NULL DEFAULT 0,
    number_of_packs INT NULL,
    pack_size INT NULL,
    qty_eaches INT NOT NULL DEFAULT 0,
    is_published TINYINT(1) NOT NULL DEFAULT 0,
    pos_visible TINYINT(1) NOT NULL DEFAULT 1,
    source ENUM('web','pos','sync') NOT NULL DEFAULT 'web',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    CONSTRAINT products_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT products_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE RESTRICT,
    CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT,
    CONSTRAINT products_stock_chk CHECK (qty_eaches >= 0 AND low_stock_threshold >= 0)
  ) ENGINE=InnoDB`,

  `CREATE TABLE suppliers (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NOT NULL,
    location_id_int INT NOT NULL,
    name TEXT NOT NULL,
    phone VARCHAR(64) NULL,
    email VARCHAR(255) NULL,
    address TEXT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    CONSTRAINT suppliers_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT suppliers_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE orders (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NULL,
    location_id_int INT NULL,
    channel ENUM('web','pos') NOT NULL,
    order_number INT NOT NULL,
    cashier_id CHAR(36) NULL,
    customer_id CHAR(36) NULL,
    register_session_id CHAR(36) NULL,
    subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
    is_order_discounted TINYINT(1) NOT NULL DEFAULT 0,
    order_discount_type ENUM('percentage','fixed') NULL,
    discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    coupon_discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    shipping_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    coupon_code VARCHAR(64) NULL,
    payment_method ENUM('cod','jazzcash','easypaisa','cash','card','mixed') NOT NULL,
    payment_status ENUM('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending',
    shipping_address TEXT NULL,
    order_status ENUM('pending','completed','voided','refunded') NOT NULL DEFAULT 'pending',
    amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
    change_due DECIMAL(12,2) NULL,
    placed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    synced_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY orders_store_number_unique (store_id, order_number),
    CONSTRAINT orders_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT orders_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL,
    CONSTRAINT orders_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES pos_staff (id) ON DELETE SET NULL,
    CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT orders_session_id_fkey FOREIGN KEY (register_session_id) REFERENCES register_sessions (id) ON DELETE SET NULL
  ) ENGINE=InnoDB`,

  `CREATE TABLE order_items (
    id CHAR(36) NOT NULL,
    order_id CHAR(36) NOT NULL,
    product_id CHAR(36) NOT NULL,
    title TEXT NOT NULL,
    sku VARCHAR(255) NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    quantity INT NOT NULL,
    subtotal DECIMAL(12,2) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
    CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
  ) ENGINE=InnoDB`,

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
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY receipts_store_number_unique (store_id, receipt_number),
    CONSTRAINT receipts_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT receipts_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL,
    CONSTRAINT receipts_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE RESTRICT,
    CONSTRAINT receipts_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES pos_staff (id) ON DELETE SET NULL
  ) ENGINE=InnoDB`,

  `CREATE TABLE payments (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NOT NULL,
    location_id_int INT NOT NULL,
    order_id CHAR(36) NOT NULL,
    gateway ENUM('cod','jazzcash','easypaisa','cash','card','mixed') NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(16) NOT NULL DEFAULT 'PKR',
    status ENUM('initiated','success','failed') NOT NULL DEFAULT 'initiated',
    gateway_transaction_id VARCHAR(255) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    CONSTRAINT payments_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT payments_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE RESTRICT,
    CONSTRAINT payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE RESTRICT
  ) ENGINE=InnoDB`,

  `ALTER TABLE receipts
    ADD CONSTRAINT receipts_payment_id_fkey
    FOREIGN KEY (payment_id) REFERENCES payments (id) ON DELETE SET NULL`,

  `CREATE TABLE coupons (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NOT NULL,
    location_id_int INT NOT NULL,
    code VARCHAR(64) NOT NULL,
    type ENUM('percentage','fixed') NOT NULL,
    value DECIMAL(12,2) NOT NULL,
    min_order_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    start_date DATETIME(6) NULL,
    end_date DATETIME(6) NULL,
    usage_limit INT NULL,
    used_count INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    pos_enabled TINYINT(1) NOT NULL DEFAULT 1,
    web_enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY coupons_code_unique (code),
    CONSTRAINT coupons_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT coupons_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE carts (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NOT NULL,
    location_id_int INT NOT NULL,
    user_id CHAR(36) NOT NULL,
    coupon_code VARCHAR(64) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    CONSTRAINT carts_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT carts_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE,
    CONSTRAINT carts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE cart_items (
    id CHAR(36) NOT NULL,
    cart_id CHAR(36) NOT NULL,
    product_id CHAR(36) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    PRIMARY KEY (id),
    UNIQUE KEY cart_items_cart_product_unique (cart_id, product_id),
    CONSTRAINT cart_items_cart_id_fkey FOREIGN KEY (cart_id) REFERENCES carts (id) ON DELETE CASCADE,
    CONSTRAINT cart_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE addresses (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NOT NULL,
    location_id_int INT NOT NULL,
    user_id CHAR(36) NOT NULL,
    name TEXT NOT NULL,
    phone VARCHAR(64) NOT NULL,
    address_line TEXT NOT NULL,
    city TEXT NOT NULL,
    postal_code VARCHAR(32) NULL,
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    CONSTRAINT addresses_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT addresses_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE,
    CONSTRAINT addresses_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE reviews (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NOT NULL,
    location_id_int INT NOT NULL,
    product_id CHAR(36) NOT NULL,
    user_id CHAR(36) NULL,
    rating INT NOT NULL,
    comment TEXT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    CONSTRAINT reviews_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT reviews_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE,
    CONSTRAINT reviews_product_id_fkey FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
    CONSTRAINT reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT reviews_rating_chk CHECK (rating >= 1 AND rating <= 5)
  ) ENGINE=InnoDB`,

  `CREATE TABLE wishlists (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NOT NULL,
    location_id_int INT NOT NULL,
    user_id CHAR(36) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    CONSTRAINT wishlists_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT wishlists_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE,
    CONSTRAINT wishlists_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE wishlist_products (
    wishlist_id CHAR(36) NOT NULL,
    product_id CHAR(36) NOT NULL,
    PRIMARY KEY (wishlist_id, product_id),
    CONSTRAINT wishlist_products_wishlist_fkey FOREIGN KEY (wishlist_id) REFERENCES wishlists (id) ON DELETE CASCADE,
    CONSTRAINT wishlist_products_product_fkey FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE stock_adjustments (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NOT NULL,
    location_id_int INT NOT NULL,
    product_id CHAR(36) NOT NULL,
    movement_type ENUM('stock_in','stock_out','adjustment','sale','refund') NOT NULL,
    reason ENUM('purchase','opening_balance','return_to_supplier','waste','damage','expiry','theft','count','sale','refund','sync','other') NOT NULL,
    reason_note TEXT NULL,
    qty_eaches INT NOT NULL,
    qty_packs DECIMAL(12,4) NULL,
    qty_packs_size INT NOT NULL,
    supplier_id CHAR(36) NULL,
    staff_id CHAR(36) NULL,
    order_id CHAR(36) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    CONSTRAINT stock_adj_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT stock_adj_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE,
    CONSTRAINT stock_adj_product_id_fkey FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
    CONSTRAINT stock_adj_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE SET NULL,
    CONSTRAINT stock_adj_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES pos_staff (id) ON DELETE SET NULL,
    CONSTRAINT stock_adj_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL,
    CONSTRAINT stock_adj_qty_chk CHECK (qty_eaches <> 0),
    CONSTRAINT stock_adj_pack_size_chk CHECK (qty_packs_size >= 2)
  ) ENGINE=InnoDB`,

  `CREATE TABLE audit_logs (
    id CHAR(36) NOT NULL,
    store_id CHAR(36) NOT NULL,
    store_id_int INT NOT NULL,
    location_id CHAR(36) NULL,
    location_id_int INT NULL,
    actor_type ENUM('user','pos_staff','system') NOT NULL,
    user_id CHAR(36) NULL,
    cashier_id CHAR(36) NULL,
    action ENUM('create','update','delete','login','logout','clock_in','clock_out','sale','void','refund','cash_in','cash_out') NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id CHAR(36) NULL,
    before_data JSON NULL,
    after_data JSON NULL,
    channel ENUM('web','pos','sync') NOT NULL,
    ip_address VARCHAR(64) NULL,
    user_agent TEXT NULL,
    note TEXT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    CONSTRAINT audit_logs_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
    CONSTRAINT audit_logs_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL,
    CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT audit_logs_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES pos_staff (id) ON DELETE SET NULL
  ) ENGINE=InnoDB`,

  `CREATE INDEX audit_logs_store_id_created_at_idx ON audit_logs (store_id, created_at)`,
  `CREATE INDEX audit_logs_store_id_entity_idx ON audit_logs (store_id, entity_type(64), entity_id)`,
]

const dropOrder = [
  "audit_logs",
  "stock_adjustments",
  "wishlist_products",
  "wishlists",
  "reviews",
  "addresses",
  "cart_items",
  "carts",
  "coupons",
  "payments",
  "receipts",
  "order_items",
  "orders",
  "suppliers",
  "products",
  "categories",
  "register_sessions",
  "pos_staff",
  "users",
  "locations",
  "shipping_rules",
  "website_content",
  "store_themes",
  "stores",
  "counters",
]

export async function up(queryInterface) {
  for (const sql of statements) {
    try {
      await queryInterface.sequelize.query(sql)
    } catch (err) {
      const msg = err.parent?.sqlMessage || err.message
      if (
        /already exists/i.test(msg) ||
        /duplicate/i.test(msg) ||
        err.parent?.code === "ER_DUP_KEYNAME" ||
        err.parent?.code === "ER_TABLE_EXISTS_ERROR"
      ) {
        continue
      }
      throw err
    }
  }
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query("SET FOREIGN_KEY_CHECKS = 0")
  for (const table of dropOrder) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS \`${table}\``)
  }
  await queryInterface.sequelize.query("SET FOREIGN_KEY_CHECKS = 1")
}
