# Railway — table changes (SQL)

Every database change made since the last push, as plain SQL for the Railway MySQL database.

> **You normally do not need to run these by hand.** When the backend starts it runs
> `src/db/ensureSchema.js`, which applies each migration below once (it checks before changing
> anything) and records it in `SequelizeMeta`. Deploying the new code to Railway is enough.
>
> Run them manually only if you want the database ready before deploying. Then:
> 1. Take a backup first.
> 2. Run the sections **in this order** (each depends on the one before).
> 3. Skip any statement whose column / table already exists (MySQL will say "Duplicate column").
> 4. At the end, insert the `SequelizeMeta` rows (last section) so the server does not try again.

---

## 1. POS workflow v2 — `20261024120000-pos-workflow-v2`

Trial / active stores, plan features, staff attendance, batches, units sold, custom sale category,
stock in transit.

### stores
```sql
ALTER TABLE stores ADD COLUMN status ENUM('trial','active') NOT NULL DEFAULT 'active' AFTER is_active;
ALTER TABLE stores ADD COLUMN trial_ends_at DATETIME NULL AFTER status;
```

### store_licenses
```sql
-- Some licenses point at devices that were deleted; the MODIFY below re-checks that link and fails.
UPDATE store_licenses l LEFT JOIN pos_devices d ON d.id = l.device_id
SET l.device_id = NULL
WHERE l.device_id IS NOT NULL AND d.id IS NULL;

ALTER TABLE store_licenses
  MODIFY COLUMN status ENUM('pending','trial','active','expired','revoked','suspended') NOT NULL DEFAULT 'pending';
ALTER TABLE store_licenses ADD COLUMN renewed_at DATETIME NULL;
```

### plans
```sql
ALTER TABLE plans ADD COLUMN max_users INT NULL AFTER max_locations;
ALTER TABLE plans ADD COLUMN reporting_level ENUM('basic','standard','advanced','custom') NOT NULL DEFAULT 'basic' AFTER max_users;
ALTER TABLE plans ADD COLUMN import_export TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN staff_attendance TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN email_integration TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN whatsapp_integration TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN receipt_customization TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN barcode_scanning TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN batch_management TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN remote_access TINYINT(1) NOT NULL DEFAULT 0;
```

### staff_sessions (new table — clock in / clock out)
```sql
CREATE TABLE IF NOT EXISTS staff_sessions (
  id CHAR(36) NOT NULL,
  store_id CHAR(36) NOT NULL,
  store_id_int INT NOT NULL,
  session_number INT NOT NULL,
  location_id CHAR(36) NULL,
  location_id_int INT NULL,
  user_id CHAR(36) NOT NULL,
  device_id CHAR(36) NULL,
  status ENUM('clock_in','clock_out') NOT NULL DEFAULT 'clock_in',
  clock_in_at DATETIME NOT NULL,
  clock_out_at DATETIME NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY staff_sessions_store_session_number_unique (store_id, session_number),
  KEY staff_sessions_store_user_status (store_id, user_id, status),
  CONSTRAINT staff_sessions_store_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
  CONSTRAINT staff_sessions_location_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL,
  CONSTRAINT staff_sessions_user_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```
> Use the same charset / collation as your `stores` table (`SHOW CREATE TABLE stores;`), otherwise
> the foreign keys are refused.

### register_sessions (batches: clock_in / clock_out → open / closed)
```sql
ALTER TABLE register_sessions
  MODIFY COLUMN status ENUM('clock_in','clock_out','open','closed') NOT NULL DEFAULT 'open';
UPDATE register_sessions SET status = 'open' WHERE status = 'clock_in';
UPDATE register_sessions SET status = 'closed' WHERE status = 'clock_out';
ALTER TABLE register_sessions MODIFY COLUMN status ENUM('open','closed') NOT NULL DEFAULT 'open';
ALTER TABLE register_sessions ADD COLUMN staff_session_id CHAR(36) NULL AFTER device_id;
```

### users (old on-duty flag; attendance is in staff_sessions now)
```sql
ALTER TABLE users DROP COLUMN status;
```

### product_stocks / stock_movements (units sold so far)
```sql
ALTER TABLE product_stocks ADD COLUMN unit_sold DECIMAL(12,4) NOT NULL DEFAULT 0 AFTER qty;
ALTER TABLE stock_movements ADD COLUMN unit_sold DECIMAL(12,4) NULL AFTER qty_after;
```

### order_items (category typed for a custom sale line)
```sql
ALTER TABLE order_items ADD COLUMN custom_category VARCHAR(255) NULL AFTER title;
```

### stock_transfers (in transit until the receiving location completes it)
```sql
ALTER TABLE stock_transfers
  MODIFY COLUMN status ENUM('pending','on_the_way','completed','cancelled') NOT NULL DEFAULT 'on_the_way';
```

---

## 2. Tax v2 — `20261025120000-tax-v2`

Sales tax (one store rate), a list of taxes per product, payment-method GST switch.

### stores
```sql
ALTER TABLE stores CHANGE COLUMN default_tax_rate sales_tax_rate DECIMAL(5,2) NULL;
ALTER TABLE stores ADD COLUMN payment_tax_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER sales_tax_rate;
```

### products (one tax → `taxes` JSON list)
```sql
ALTER TABLE products ADD COLUMN taxes JSON NULL AFTER discount_name;

-- Copy each product's old single tax into the list.
UPDATE products
SET taxes = JSON_ARRAY(JSON_OBJECT(
  'name', COALESCE(tax_name, 'Tax'),
  'type', tax_type,
  'value', CAST(tax_value AS DECIMAL(12,2))
))
WHERE tax_type IS NOT NULL AND tax_value IS NOT NULL AND (taxes IS NULL OR JSON_LENGTH(taxes) = 0);

UPDATE products SET taxes = JSON_ARRAY() WHERE taxes IS NULL;
```

The two price totals were *generated* columns built from the old tax columns. Keep their values and
turn them into normal columns (only if `SHOW COLUMNS FROM products` shows them as GENERATED):
```sql
ALTER TABLE products ADD COLUMN total_price_each_unit_tmp DECIMAL(12,2) NULL;
UPDATE products SET total_price_each_unit_tmp = total_price_each_unit;
ALTER TABLE products DROP COLUMN total_price_each_unit;
ALTER TABLE products CHANGE COLUMN total_price_each_unit_tmp total_price_each_unit DECIMAL(12,2) NULL;

ALTER TABLE products ADD COLUMN total_pack_price_tmp DECIMAL(12,2) NULL;
UPDATE products SET total_pack_price_tmp = total_pack_price;
ALTER TABLE products DROP COLUMN total_pack_price;
ALTER TABLE products CHANGE COLUMN total_pack_price_tmp total_pack_price DECIMAL(12,2) NULL;
```
Then drop the old single-tax columns:
```sql
ALTER TABLE products DROP COLUMN tax_type;
ALTER TABLE products DROP COLUMN tax_value;
ALTER TABLE products DROP COLUMN tax_name;
```

### orders / order_items
```sql
ALTER TABLE orders CHANGE COLUMN default_tax_rate sales_tax_rate DECIMAL(5,2) NULL;
ALTER TABLE orders CHANGE COLUMN default_tax_amount sales_tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE order_items CHANGE COLUMN default_tax_amount sales_tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE order_items ADD COLUMN product_taxes JSON NULL AFTER sales_tax_amount;
UPDATE order_items
SET product_taxes = JSON_ARRAY(JSON_OBJECT(
  'name', 'Tax',
  'type', product_tax_type,
  'value', product_tax_value,
  'amount', product_tax_amount
))
WHERE product_tax_type IS NOT NULL;

ALTER TABLE order_items DROP COLUMN product_tax_type;
ALTER TABLE order_items DROP COLUMN product_tax_value;
```

### payment_method_tax_rates (default rates for every store that is missing them)
```sql
INSERT INTO payment_method_tax_rates (id, store_id, store_id_int, payment_method, gst_percent, created_at, updated_at)
SELECT UUID(), s.id, s.store_id_int, 'cash', 16, NOW(), NOW() FROM stores s
WHERE NOT EXISTS (SELECT 1 FROM payment_method_tax_rates r WHERE r.store_id = s.id AND r.payment_method = 'cash');

INSERT INTO payment_method_tax_rates (id, store_id, store_id_int, payment_method, gst_percent, created_at, updated_at)
SELECT UUID(), s.id, s.store_id_int, 'card', 5, NOW(), NOW() FROM stores s
WHERE NOT EXISTS (SELECT 1 FROM payment_method_tax_rates r WHERE r.store_id = s.id AND r.payment_method = 'card');

INSERT INTO payment_method_tax_rates (id, store_id, store_id_int, payment_method, gst_percent, created_at, updated_at)
SELECT UUID(), s.id, s.store_id_int, 'jazzcash', 5, NOW(), NOW() FROM stores s
WHERE NOT EXISTS (SELECT 1 FROM payment_method_tax_rates r WHERE r.store_id = s.id AND r.payment_method = 'jazzcash');

INSERT INTO payment_method_tax_rates (id, store_id, store_id_int, payment_method, gst_percent, created_at, updated_at)
SELECT UUID(), s.id, s.store_id_int, 'easypaisa', 5, NOW(), NOW() FROM stores s
WHERE NOT EXISTS (SELECT 1 FROM payment_method_tax_rates r WHERE r.store_id = s.id AND r.payment_method = 'easypaisa');
```

---

## 3. Sales tax on / off — `20261025130000-sales-tax-toggle`

### stores
```sql
ALTER TABLE stores ADD COLUMN sales_tax_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER sales_tax_rate;

-- Existing stores keep what they charge today: a store with a rate stays on; one without gets 18% stored but off.
UPDATE stores
SET sales_tax_enabled = CASE WHEN sales_tax_rate IS NOT NULL AND sales_tax_rate > 0 THEN 1 ELSE 0 END,
    sales_tax_rate = CASE WHEN sales_tax_rate IS NULL OR sales_tax_rate = 0 THEN 18 ELSE sales_tax_rate END;

ALTER TABLE stores MODIFY COLUMN sales_tax_rate DECIMAL(5,2) NULL DEFAULT 18;
```

---

## 4. Currency — `20261026120000-currencies`

### currencies (new table, one row per store; new stores get PKR at registration)
```sql
CREATE TABLE IF NOT EXISTS currencies (
  id CHAR(36) NOT NULL,
  store_id CHAR(36) NOT NULL,
  store_id_int INT NOT NULL,
  code VARCHAR(3) NOT NULL DEFAULT 'PKR',
  name VARCHAR(64) NOT NULL DEFAULT 'Pakistani Rupee',
  symbol VARCHAR(8) NOT NULL DEFAULT 'Rs',
  decimal_places TINYINT NOT NULL DEFAULT 2,
  symbol_position ENUM('before','after') NOT NULL DEFAULT 'before',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY currencies_store_id_unique (store_id)
) ENGINE=InnoDB;
```
> Stores registered before this have no row; `PUT /currency` creates it (until then `GET /currency`
> shows the PKR defaults).

---

## 5. Refund type — `20261027120000-refund-type`

### order_refunds (complete = whole order, partial = some items)
```sql
ALTER TABLE order_refunds
  ADD COLUMN refund_type ENUM('complete','partial') NOT NULL DEFAULT 'partial' AFTER receipt_id;

-- Older refunds of orders that ended up fully refunded count as complete.
UPDATE order_refunds r JOIN orders o ON o.id = r.order_id
SET r.refund_type = 'complete'
WHERE o.order_status = 'refunded';
```

---

## 6. Transaction number — `20261028120000-transaction-number`

### payments (transaction id 1, 2, 3… per store)
```sql
ALTER TABLE payments ADD COLUMN transaction_number INT NULL AFTER order_id;

-- Number the existing payments per store, oldest first.
UPDATE payments p
JOIN (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY store_id ORDER BY created_at, id) AS n FROM payments
) numbered ON numbered.id = p.id
SET p.transaction_number = numbered.n;

-- Each store's counter continues from its last number.
INSERT INTO counters (name, seq)
SELECT CONCAT('transaction:', store_id), MAX(transaction_number) FROM payments GROUP BY store_id
ON DUPLICATE KEY UPDATE seq = GREATEST(counters.seq, VALUES(seq));

ALTER TABLE payments
  ADD UNIQUE KEY payments_store_transaction_number_unique (store_id, transaction_number);
```

---

## 7. Refund payments — `20261029120000-refund-payments`

How each refund was paid back, per method of the sale (card / cash / credit = udhaar).

```sql
ALTER TABLE order_refunds ADD COLUMN payments JSON NULL AFTER tax_amount;
```

## 8. Transfer received qty — `20261030120000-transfer-received-qty`

What arrived at the destination (partial receive).

```sql
ALTER TABLE stock_transfers ADD COLUMN received_qty DECIMAL(12,4) NULL AFTER qty;
UPDATE stock_transfers SET received_qty = qty WHERE status = 'completed';
```

## After a manual run: mark the migrations as done

So the server does not try them again on start:
```sql
INSERT IGNORE INTO SequelizeMeta (name) VALUES
  ('20261024120000-pos-workflow-v2'),
  ('20261025120000-tax-v2'),
  ('20261025130000-sales-tax-toggle'),
  ('20261026120000-currencies'),
  ('20261027120000-refund-type'),
  ('20261028120000-transaction-number'),
  ('20261029120000-refund-payments'),
  ('20261030120000-transfer-received-qty');
```

## Check

```sql
SELECT name FROM SequelizeMeta WHERE name >= '20261024' ORDER BY name;
SHOW COLUMNS FROM stores LIKE '%tax%';
SHOW COLUMNS FROM payments LIKE 'transaction_number';
SHOW COLUMNS FROM order_refunds LIKE 'refund_type';
SHOW COLUMNS FROM order_refunds LIKE 'payments';
SHOW COLUMNS FROM stock_transfers LIKE 'received_qty';
SHOW TABLES LIKE 'currencies';
SHOW TABLES LIKE 'staff_sessions';
```
