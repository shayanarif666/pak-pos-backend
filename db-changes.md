# Database changes — phase 1

**Prepared:** 24 October 2026 · **Baseline:** `db.md` (45 tables, generated from the Sequelize models) ·
**Input:** the Pakistan-market schema audit (`pos_database_schema_updates_pakistan.md`)

This file lists **only the tables that change**: 9 existing tables that get new columns and 11 new
tables. Every updated table is shown in full (existing + new columns) so it can be read on its own.

Legend for the **Status** column: `existing` = already in the database, unchanged ·
**`NEW`** = column to add · **`CHANGED`** = existing column whose type / null / enum changes.

---

## 0. Decisions (read first)

### What the audit found that is real

| Problem today | Fixed by |
|---|---|
| One `expiry_date` per product per location — a second delivery with another expiry overwrites the first | `product_batches`, `track_batches`, `batch_id` on stock movements / order lines |
| Buying stock is only a `stock_in` movement — no supplier bill, due date, what we owe, or returns | `purchase_invoices`, `purchase_returns`, `supplier_payments`, links on `supplier_ledger` |
| One supplier payment can't be matched to the bills it settles | `supplier_payment_allocations` |
| A stock transfer carries one product | `stock_transfer_items` + transfer header fields |
| Profit ignores rent, bills, salaries | `expense_categories`, `expenses` |
| A product has one barcode (no carton / pack / second-supplier barcode) | `product_barcodes` |
| No Raast / bank transfer / cheque, no payment reference for bank matching | payment method values + `payments` reference / settlement fields |
| Stock value and real profit need a moving average cost | `product_stocks.average_cost`, `stock_movements.unit_cost` |

### What the audit suggested that we already have (not repeated here)

| Audit suggestion | Already in our schema |
|---|---|
| `stores`: legal_name, address, phone, tax number, currency, timezone | `legal_name`, `address`, `contact_phone`, `ntn`, `strn`, `currency` (PKR), `timezone` (Asia/Karachi) — **`stores` needs no change** |
| `orders.client_idempotency_key` + unique index | `client_local_id` + UNIQUE (`store_id`, `client_local_id`); a retried sync returns the existing order |
| `orders`: status, currency, discount total, subtotal before discount, cancellation reason | `order_status`, `discount_amount`, `gross_amount`, `cancel_reason` / `cancelled_by`; currency comes from the store |
| `order_items` snapshots (name, SKU, barcode, unit, qty, price, cost, discount, subtotal) | `title`, `sku`, `barcode`, `unit`, `quantity`, `unit_price`, `cost_price`, `discount_amount`, `subtotal`, plus tax snapshots (`product_tax_type/value`, `category_tax_type/value`) — all frozen at sale time |
| `payments.paid_at`, payment reference | `paid_at`, `gateway_transaction_id`, `idempotency_key` |
| `suppliers.contact_email`, `is_active` | `email`, `is_active` |
| `stock_transfers.transfer_number`, from / to, status, notes | all exist |
| Unit conversions (pack ↔ piece) | `is_pack_product`, `pack_size`, `pack_cost_price`, `pack_selling_price`, `sell_loose` |
| `allow_fractional_qty` | `is_weight_based` |

### Deferred to a later phase (deliberately not in phase 1)

| Audit item | Why later |
|---|---|
| `tax_types`, `tax_rules`, `product_tax_assignments`, `order_item_taxes` | Tax already works at product, category, store and payment-method level, and every sale line stores its tax snapshot. The rules (which rate applies, whether a card rate replaces or adds to sales tax) must be confirmed with an accountant first; building the tables before the rules are known would freeze the wrong model. |
| `purchase_orders`, `goods_receipts` (+ items) | Most of our stores receive goods together with the supplier's bill. Phase 1 `purchase_invoices` records "received + billed" in one posted document. Separate PO / receipt documents come when a customer needs approval before buying. |
| `product_units` (carton → pack → piece chains) | The pack fields cover one level; `product_barcodes.units_per_barcode` lets a carton barcode scan as 12 units. Full multi-level units can follow. |
| `fbr_invoice_submissions` | Only needed once FBR / integrator submission is built. |
| `payment_reconciliations` | Phase 1 adds `settlement_status` / `settled_at` on `payments`, enough to mark card / Raast settlement. A statement-matching table comes with bank imports. |
| `accounting_accounts`, `journal_entries`, `journal_entry_lines` | Full double-entry accounting; only after posting rules are defined. |
| `product_stocks.reserved_qty` | Nothing reserves stock yet (no holds / layaway). Add with that feature. |
| `orders.tax_calculation_version`, `order_items.line_total` | `line_total` = `subtotal` + `tax_amount` (derivable, would be a second source of truth); a tax version is only useful with the tax-rule tables. |

### Conventions used by every new table (same as the existing schema)

- `id` CHAR(36) UUID primary key.
- `store_id` + `store_id_int` (and `location_id` + `location_id_int` where the row belongs to a branch).
- `*_number` — short per-store sequence 1, 2, 3 (from `counters`), what the POS and the receipts show.
- Money `DECIMAL(12,2)`; quantities `DECIMAL(12,4)`; unit costs `DECIMAL(12,4)`.
- Documents that move stock or money are **posted, never edited or deleted**: a mistake is undone by a
  reversal (`status` = `reversed` / `cancelled` + the opposite movement), so history stays auditable.
- Posting a document (stock + ledger + totals) happens in **one database transaction**.

---

## 1. Updated tables

### 1.1 `products`

**Why it changes:** we can't tell whether a price already includes tax, can't sell services (repairs,
delivery) without them creating stock, and can't switch a product to batch / expiry tracking.

| Column | Type | Null | Default | Status | Purpose |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID | existing | Row id |
| `store_id` | CHAR(36) | NO |  | existing | Store (FK stores.id) |
| `store_id_int` | INT | NO |  | existing | Store number |
| `product_number` | INT | NO |  | existing | Short product id per store |
| `category_id` | CHAR(36) | NO |  | existing | Category (FK categories.id) |
| `title` | TEXT | NO |  | existing | Product name |
| `slug` | VARCHAR(255) | NO |  | existing | URL name (auto -2, -3 for duplicates) |
| `sku` | VARCHAR(255) | NO |  | existing | Stock-keeping code |
| `barcode` | VARCHAR(255) | YES |  | existing | Main barcode (unique per store); extra barcodes go to `product_barcodes` |
| `images` | JSON | YES | [] | existing | Image list |
| `featured_image` | TEXT | YES |  | existing | Main image URL |
| `description` | TEXT | YES |  | existing | Description |
| `unit` | ENUM(piece … can) | NO | piece | existing | Selling unit |
| `cost_price` | DECIMAL(12,2) | NO |  | existing | Cost of one unit (last purchase) |
| `selling_price` | DECIMAL(12,2) | NO |  | existing | Price of one unit |
| `has_product_discount` | TINYINT(1) | NO | 0 | existing | Product discount on |
| `discount_type` | ENUM(percentage, fixed) | YES |  | existing | Discount kind |
| `discount_value` | DECIMAL(12,2) | YES |  | existing | Discount amount / % |
| `discount_name` | VARCHAR(255) | YES |  | existing | Discount label |
| `tax_type` | ENUM(percentage, fixed) | YES |  | existing | Product tax kind |
| `tax_value` | DECIMAL(12,2) | YES |  | existing | Product tax amount / % |
| `tax_name` | VARCHAR(255) | YES |  | existing | Tax label (e.g. GST) |
| **`tax_inclusive`** | TINYINT(1) | NO | 0 | **NEW** | Selling price already includes the tax |
| `is_pack_product` | TINYINT(1) | NO | 0 | existing | Sold as a pack |
| `pack_size` | INT | YES |  | existing | Units per pack |
| `pack_cost_price` | DECIMAL(12,2) | YES |  | existing | Whole-pack cost |
| `pack_selling_price` | DECIMAL(12,2) | YES |  | existing | Whole-pack price |
| `sell_loose` | TINYINT(1) | NO | 0 | existing | Units can also be sold one by one |
| `is_weight_based` | TINYINT(1) | NO | 0 | existing | Sold by weight (fractional qty) |
| **`is_service`** | TINYINT(1) | NO | 0 | **NEW** | A service, not a physical item |
| **`track_batches`** | TINYINT(1) | NO | 0 | **NEW** | Stock is kept per batch (expiry / lot) |
| `has_bulk_discount` | TINYINT(1) | NO | 0 | existing | Has bulk-quantity tiers |
| `low_stock_threshold` | DECIMAL(12,4) | NO | 10 | existing | Low-stock alert level |
| `total_price_each_unit` | DECIMAL(12,2) | YES |  | existing | Generated: unit price after discount + tax |
| `total_pack_price` | DECIMAL(12,2) | YES |  | existing | Generated: pack price after discount + tax |
| `is_published` | TINYINT(1) | NO | 0 | existing | Shown on the web store |
| `is_pos_visible` | TINYINT(1) | NO | 1 | existing | Shown on the POS |
| `is_web_visible` | TINYINT(1) | NO | 1 | existing | Shown on the web |
| `channel` | ENUM(web, pos, both) | NO | both | existing | Where it is sold |
| `is_active` | TINYINT(1) | NO | 1 | existing | false = disabled |
| `created_at` / `updated_at` | DATETIME | NO |  | existing | Timestamps |

**New columns**

- **`tax_inclusive`**
  - *Why:* in Pakistan many shelf prices are printed tax-inclusive (MRP).
  - *Benefit:* the till takes the tax **out of** the price instead of adding it on top, so the bill matches the shelf price.
  - *Without it:* a Rs 100 MRP item with 18% tax rings up as Rs 118 — the customer is overcharged and the tax report is wrong.
- **`is_service`**
  - *Why:* repairs, alterations, delivery or installation are sold but have no stock.
  - *Benefit:* sales skip stock deduction and low-stock alerts for these items.
  - *Without it:* a service needs a fake stock count, goes "out of stock", and shows up in inventory value.
- **`track_batches`**
  - *Why:* only some products (food, medicine, cosmetics) need batch / expiry tracking.
  - *Benefit:* the till asks for / picks a batch only for these products; everything else stays simple.
  - *Without it:* either every product must carry batches (slow for a general store) or none can (expiry stays broken).

```sql
ALTER TABLE products
  ADD COLUMN tax_inclusive TINYINT(1) NOT NULL DEFAULT 0 AFTER tax_name,
  ADD COLUMN is_service    TINYINT(1) NOT NULL DEFAULT 0 AFTER is_weight_based,
  ADD COLUMN track_batches TINYINT(1) NOT NULL DEFAULT 0 AFTER is_service;
```

---

### 1.2 `product_stocks`

**Why it changes:** it stays the per-location stock summary, but needs a cost to value stock and a
record of the last physical count. Batch-level quantities move to `product_batches`.

| Column | Type | Null | Default | Status | Purpose |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID | existing | Row id |
| `store_id` / `store_id_int` | CHAR(36) / INT | NO |  | existing | Store |
| `location_id` / `location_id_int` | CHAR(36) / INT | NO |  | existing | Location |
| `product_id` | CHAR(36) | NO |  | existing | Product (FK products.id) |
| `qty` | DECIMAL(12,4) | NO | 0 | existing | On-hand quantity (for batch products = sum of active batches) |
| `unit_sold` | DECIMAL(12,4) | NO | 0 | existing | Units sold so far |
| `low_stock_threshold` | DECIMAL(12,4) | YES |  | existing | Location-specific alert level |
| `expiry_date` | DATE | YES |  | **CHANGED** (meaning) | For batch products: earliest expiry among active batches, kept up to date from `product_batches` (for alerts and lists) |
| **`average_cost`** | DECIMAL(12,4) | YES |  | **NEW** | Moving average cost per unit at this location |
| **`last_counted_at`** | DATETIME | YES |  | **NEW** | When stock was last physically counted |
| `is_pos_visible` / `is_web_visible` / `channel` | | NO |  | existing | Visibility |
| `created_at` / `updated_at` | DATETIME | NO |  | existing | Timestamps |

**New columns**

- **`average_cost`**
  - *Why:* the same item is bought at different prices over time.
  - *Benefit:* stock value and the cost of each sale use the real average cost, not the latest purchase price.
  - *Without it:* profit and stock value are wrong whenever purchase prices change (they all use `products.cost_price`).
- **`last_counted_at`**
  - *Why:* stock counts (`reason` = `count`) are how shrinkage and theft are found.
  - *Benefit:* shows which items haven't been counted recently and supports cycle counting.
  - *Without it:* nobody knows when a location's stock was last verified.

**Changed:** `expiry_date` is no longer typed in for batch products; it is recalculated from the
batches. Without that, the "expiring soon" list would show one random batch's date.

```sql
ALTER TABLE product_stocks
  ADD COLUMN average_cost    DECIMAL(12,4) NULL AFTER unit_sold,
  ADD COLUMN last_counted_at DATETIME      NULL AFTER expiry_date;
```

---

### 1.3 `stock_movements`

**Why it changes:** every stock change must point to the document and batch that caused it, and carry
its cost, so stock history can be traced and valued.

| Column | Type | Null | Default | Status | Purpose |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID | existing | Row id |
| `store_id` / `store_id_int` | CHAR(36) / INT | NO |  | existing | Store |
| `movement_number` | INT | NO |  | existing | Short id per store |
| `location_id` / `location_id_int` | CHAR(36) / INT | NO |  | existing | Location |
| `product_id` | CHAR(36) | NO |  | existing | Product |
| **`batch_id`** | CHAR(36) | YES |  | **NEW** | Batch moved (FK product_batches.id) |
| `movement_type` | ENUM(stock_in, stock_out, adjustment, sale, refund, transfer_out, transfer_in, custom_sale) | NO |  | existing | Kind of change |
| `reason` | ENUM(purchase, opening_balance, …) | NO |  | existing | Why |
| `reason_note` | TEXT | YES |  | existing | Free text |
| `qty` | DECIMAL(12,4) | NO |  | existing | Change (+ / −) |
| `qty_after` | DECIMAL(12,4) | YES |  | existing | Location stock right after |
| `unit_sold` | DECIMAL(12,4) | YES |  | existing | Units sold so far, after this movement |
| **`unit_cost`** | DECIMAL(12,4) | YES |  | **NEW** | Cost per unit of this movement |
| **`source_type`** | ENUM(manual, order, refund, purchase_invoice, purchase_return, stock_transfer) | NO | manual | **NEW** | Document that caused it |
| **`source_id`** | CHAR(36) | YES |  | **NEW** | That document's id |
| `supplier_id` | CHAR(36) | YES |  | existing | Supplier (purchases) |
| `staff_id` | CHAR(36) | YES |  | existing | Staff member |
| `order_id` | CHAR(36) | YES |  | existing | Order (sales / refunds) |
| `is_pos_visible` / `is_web_visible` / `channel` | | NO |  | existing | Visibility |
| `created_at` | DATETIME | NO |  | existing | When it happened (movements are never edited) |

**New columns**

- **`batch_id`**
  - *Why:* a sale, purchase or transfer of a batch product must say which batch.
  - *Benefit:* each batch's quantity history is traceable; recalls ("which customers got batch X") become possible.
  - *Without it:* batch quantities can't be reconciled with movements.
- **`unit_cost`**
  - *Why:* a movement's value is qty × cost at that moment.
  - *Benefit:* feeds `average_cost` and stock-value reports, and gives the exact cost of each sale.
  - *Without it:* stock value has to be re-derived from current prices, which is wrong for past dates.
- **`source_type` + `source_id`**
  - *Why:* today only sales link back (`order_id`); purchases, returns and transfers don't.
  - *Benefit:* every movement opens the document behind it, and a retried post can be detected (same source → already applied).
  - *Without it:* "why did stock change?" has no answer for purchases, returns or transfers, and a double post can't be spotted.

```sql
ALTER TABLE stock_movements
  ADD COLUMN batch_id    CHAR(36)      NULL AFTER product_id,
  ADD COLUMN unit_cost   DECIMAL(12,4) NULL AFTER unit_sold,
  ADD COLUMN source_type ENUM('manual','order','refund','purchase_invoice','purchase_return','stock_transfer')
                         NOT NULL DEFAULT 'manual' AFTER unit_cost,
  ADD COLUMN source_id   CHAR(36)      NULL AFTER source_type,
  ADD KEY stock_movements_source (store_id, source_type, source_id);
```

---

### 1.4 `orders`

**Why it changes:** partial refunds aren't visible on the order, void / cancel times aren't stored,
rounding (Rs 99.75 → Rs 100) isn't recorded, and Raast / bank transfer / cheque can't be chosen.

| Column | Type | Null | Default | Status | Purpose |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID | existing | Row id |
| `store_id` / `store_id_int` | CHAR(36) / INT | NO |  | existing | Store |
| `location_id` / `location_id_int` | CHAR(36) / INT | YES |  | existing | Location |
| `channel` | ENUM(web, pos) | NO |  | existing | Where sold |
| `is_pos_visible` / `is_web_visible` | TINYINT(1) | NO | 1 | existing | Visibility |
| `is_custom` | TINYINT(1) | NO | 0 | existing | Custom sale |
| `order_number` | INT | NO |  | existing | Short id per store |
| `cashier_id` | CHAR(36) | YES |  | existing | Staff member |
| `customer_id` | CHAR(36) | YES |  | existing | Customer |
| `register_session_id` | CHAR(36) | YES |  | existing | Batch (cash drawer) |
| `client_local_id` | VARCHAR(255) | YES |  | existing | Offline idempotency key (unique per store) |
| `gross_amount` | DECIMAL(12,2) | NO | 0 | existing | List price × qty |
| `line_discount_amount` | DECIMAL(12,2) | NO | 0 | existing | Line discounts |
| `subtotal` | DECIMAL(12,2) | NO | 0 | existing | After line discounts, before tax |
| `is_order_discounted` / `order_discount_type` / `discount_amount` | | | | existing | Whole-order discount |
| `coupon_id` / `coupon_code` / `coupon_discount_amount` | | | | existing | Coupon |
| `tax_amount` | DECIMAL(12,2) | NO | 0 | existing | All tax |
| `default_tax_rate` / `default_tax_amount` | | | | existing | Store tax |
| `product_tax_amount` / `category_tax_amount` | DECIMAL(12,2) | NO | 0 | existing | Line taxes |
| `payment_gst_amount` | DECIMAL(12,2) | NO | 0 | existing | Payment-method GST |
| `fbr_invoice_enabled` / `fbr_tax_amount` | | | | existing | FBR |
| `tax_breakdown` | JSON | YES |  | existing | Tax detail for the receipt |
| `shipping_fee` | DECIMAL(12,2) | NO | 0 | existing | Delivery (web) |
| **`rounding_adjustment`** | DECIMAL(12,2) | NO | 0 | **NEW** | Cash rounding (+ / −) included in `total_amount` |
| `total_amount` | DECIMAL(12,2) | NO | 0 | existing | Amount to pay |
| `cost_total` | DECIMAL(12,2) | NO | 0 | existing | Cost of goods |
| `payment_method` | ENUM(cash, card, jazzcash, easypaisa, **bank_transfer, raast, cheque**, cod, mixed) | NO |  | **CHANGED** | Payment method |
| `payment_status` | ENUM(pending, paid, failed, refunded) | NO | pending | existing | Payment state |
| `shipping_address` | TEXT | YES |  | existing | Web delivery address |
| `order_status` | ENUM(pending, completed, voided, cancelled, **partially_refunded**, refunded) | NO | pending | **CHANGED** | Order state |
| `amount_paid` / `change_due` | DECIMAL(12,2) | | | existing | Tendered / change |
| `void_reason` / `voided_by` | | YES |  | existing | Void |
| **`voided_at`** | DATETIME | YES |  | **NEW** | When it was voided |
| `cancel_reason` / `cancelled_by` | | YES |  | existing | Cancel |
| **`cancelled_at`** | DATETIME | YES |  | **NEW** | When it was cancelled |
| `placed_at` | DATETIME | NO | now | existing | When the sale happened |
| `synced_at` | DATETIME | YES |  | existing | When an offline sale reached the server |
| `created_at` / `updated_at` | DATETIME | NO |  | existing | Timestamps |

**New / changed columns**

- **`rounding_adjustment`**
  - *Why:* cash bills are usually rounded to the nearest rupee.
  - *Benefit:* the bill shows the rounding separately; tax and subtotals stay exact while the cash drawer matches.
  - *Without it:* rounding is hidden inside a total that no longer equals subtotal + tax, and the batch shows small unexplained variances.
- **`voided_at`, `cancelled_at`**
  - *Why:* `updated_at` changes on any edit, so it can't say when a void / cancel happened.
  - *Benefit:* void and cancel reports by date and per shift (fraud checks).
  - *Without it:* there is no reliable time for the most sensitive cashier actions.
- **`payment_method`** gets `bank_transfer`, `raast`, `cheque`
  - *Why:* common payment ways in Pakistan beyond cash, card and wallets.
  - *Benefit:* sales and batch closing show these totals separately.
  - *Without it:* they get recorded as "cash" or "card", which breaks drawer counts and bank matching.
- **`order_status`** gets `partially_refunded`
  - *Why:* a partial refund currently leaves the order `completed`.
  - *Benefit:* order lists and reports show which sales were partly returned.
  - *Without it:* finding them means scanning every line's `refunded_qty`.

```sql
ALTER TABLE orders
  ADD COLUMN rounding_adjustment DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER shipping_fee,
  ADD COLUMN voided_at    DATETIME NULL AFTER voided_by,
  ADD COLUMN cancelled_at DATETIME NULL AFTER cancelled_by,
  MODIFY COLUMN payment_method
    ENUM('cash','card','jazzcash','easypaisa','bank_transfer','raast','cheque','cod','mixed') NOT NULL,
  MODIFY COLUMN order_status
    ENUM('pending','completed','voided','cancelled','partially_refunded','refunded') NOT NULL DEFAULT 'pending';
```

The same three payment methods must be added wherever the method enum is stored:
`payments.method`, `payment_method_tax_rates.payment_method` and `PAYMENT_METHOD` in `db/enums.js`.

---

### 1.5 `order_items`

**Why it changes:** a sold line of a batch product must remember which batch it came from.

| Column | Type | Null | Default | Status | Purpose |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID | existing | Row id |
| `order_id` | CHAR(36) | NO |  | existing | Order |
| `item_number` | INT | NO |  | existing | Line number in the order |
| `is_pos_visible` / `is_web_visible` / `channel` | | NO |  | existing | Visibility |
| `product_id` | CHAR(36) | YES |  | existing | Product (null = custom line) |
| **`batch_id`** | CHAR(36) | YES |  | **NEW** | Batch sold (FK product_batches.id) |
| `title` | TEXT | NO |  | existing | Name at sale time |
| `custom_category` | VARCHAR(255) | YES |  | existing | Custom line category |
| `sku` / `barcode` / `unit` | | YES |  | existing | Snapshot at sale time |
| `is_weight_based` / `weight` / `qty_packs` | | | | existing | Weight / pack detail |
| `unit_price` | DECIMAL(12,2) | NO |  | existing | Price at sale time |
| `cost_price` | DECIMAL(12,2) | NO | 0 | existing | Cost at sale time |
| `quantity` | DECIMAL(12,4) | NO |  | existing | Qty sold |
| `refunded_qty` | DECIMAL(12,4) | NO | 0 | existing | Qty returned so far |
| `discount_amount` | DECIMAL(12,2) | NO | 0 | existing | Line discount |
| `tax_amount` + `product_/category_/default_tax_amount` | DECIMAL(12,2) | NO | 0 | existing | Line tax snapshot |
| `product_tax_type/value`, `category_tax_type/value` | | YES |  | existing | Tax setting snapshot |
| `subtotal` | DECIMAL(12,2) | NO |  | existing | After discount, before tax |

**New column**

- **`batch_id`**
  - *Why:* a refund must put stock back into the same batch, and a recall needs to know who got which batch.
  - *Benefit:* refunds restock the right batch, and expiry / recall is traceable per sale.
  - *Without it:* returned items land in the wrong batch and batch quantities drift from reality.

```sql
ALTER TABLE order_items ADD COLUMN batch_id CHAR(36) NULL AFTER product_id;
```

---

### 1.6 `payments`

**Why it changes:** bank transfer, Raast and cheque need a reference and a settlement state to be
matched against the bank statement.

| Column | Type | Null | Default | Status | Purpose |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID | existing | Row id |
| `store_id` / `store_id_int` | CHAR(36) / INT | NO |  | existing | Store |
| `location_id` / `location_id_int` | CHAR(36) / INT | YES |  | existing | Location |
| `order_id` | CHAR(36) | NO |  | existing | Order |
| `is_pos_visible` / `is_web_visible` / `channel` | | NO |  | existing | Visibility |
| `method` | ENUM(cash, card, jazzcash, easypaisa, **bank_transfer, raast, cheque**, cod, mixed) | NO |  | **CHANGED** | Payment method |
| `amount` | DECIMAL(12,2) | NO |  | existing | Amount |
| `tax_amount` | DECIMAL(12,2) | NO | 0 | existing | Payment GST on it |
| `currency` | VARCHAR(16) | NO | PKR | existing | Currency |
| `status` | ENUM(initiated, success, failed) | NO | initiated | existing | Payment state |
| `gateway_transaction_id` | VARCHAR(255) | YES |  | existing | Online gateway's transaction id |
| **`reference_number`** | VARCHAR(150) | YES |  | **NEW** | Cheque no. / bank or Raast transaction ref / card slip no. |
| **`provider_name`** | VARCHAR(100) | YES |  | **NEW** | Bank / card machine / wallet that received it |
| **`settlement_status`** | ENUM(not_applicable, pending, settled, failed) | NO | not_applicable | **NEW** | Has the money reached the store's account |
| **`settled_at`** | DATETIME | YES |  | **NEW** | When it settled |
| `idempotency_key` | VARCHAR(255) | YES |  | existing | Duplicate-callback guard |
| `raw_payload` | JSON | YES |  | existing | Gateway payload |
| `paid_at` | DATETIME | YES |  | existing | When paid |
| `failure_reason` | TEXT | YES |  | existing | Why it failed |
| `created_at` / `updated_at` | DATETIME | NO |  | existing | Timestamps |

**New / changed columns**

- **`method`** gets `bank_transfer`, `raast`, `cheque` — same reason as `orders.payment_method`.
- **`reference_number`**
  - *Why:* `gateway_transaction_id` is for an online gateway; a cheque number or a Raast / bank reference is something else.
  - *Benefit:* each non-cash payment can be found in the bank statement.
  - *Without it:* references end up in notes, or are lost, and bank matching is manual guesswork.
- **`provider_name`**
  - *Why:* a store may have several card machines or bank accounts.
  - *Benefit:* settlements are checked per bank / machine.
  - *Without it:* "card" totals can't be split by which machine or bank should pay them.
- **`settlement_status`, `settled_at`**
  - *Why:* card and Raast money arrives days later; cheques can bounce.
  - *Benefit:* shows money still expected from banks, and flags failed settlements and bounced cheques.
  - *Without it:* a bounced cheque or a missing card settlement still counts as received money.

```sql
ALTER TABLE payments
  MODIFY COLUMN method
    ENUM('cash','card','jazzcash','easypaisa','bank_transfer','raast','cheque','cod','mixed') NOT NULL,
  ADD COLUMN reference_number  VARCHAR(150) NULL AFTER gateway_transaction_id,
  ADD COLUMN provider_name     VARCHAR(100) NULL AFTER reference_number,
  ADD COLUMN settlement_status ENUM('not_applicable','pending','settled','failed')
                               NOT NULL DEFAULT 'not_applicable' AFTER provider_name,
  ADD COLUMN settled_at        DATETIME NULL AFTER settlement_status;
```

---

### 1.7 `suppliers`

**Why it changes:** buying on credit needs the supplier's legal identity, how many days of credit
they give, and what we already owed them when we started using the system.

| Column | Type | Null | Default | Status | Purpose |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID | existing | Row id |
| `store_id` / `store_id_int` | CHAR(36) / INT | NO |  | existing | Store |
| `supplier_number` | INT | NO |  | existing | Short id per store |
| `name` | TEXT | NO |  | existing | Trading name |
| **`legal_name`** | VARCHAR(255) | YES |  | **NEW** | Registered business name |
| **`ntn`** | VARCHAR(50) | YES |  | **NEW** | Supplier's NTN |
| **`strn`** | VARCHAR(50) | YES |  | **NEW** | Supplier's sales tax registration number |
| `phone` | VARCHAR(64) | YES |  | existing | Phone |
| `email` | VARCHAR(255) | YES |  | existing | Email |
| `address` | TEXT | YES |  | existing | Address |
| `payment_terms` | TEXT | YES |  | existing | Terms as text (e.g. "Net 15") |
| **`payment_terms_days`** | INT | NO | 0 | **NEW** | Credit days (0 = cash) |
| **`opening_balance`** | DECIMAL(12,2) | NO | 0 | **NEW** | Amount owed to the supplier on the start date |
| `location_scope` | ENUM(all, selected) | NO | all | existing | Branches served |
| `is_active` | TINYINT(1) | NO | 1 | existing | false = disabled |
| `is_pos_visible` / `is_web_visible` / `channel` | | NO |  | existing | Visibility |
| `created_at` / `updated_at` | DATETIME | NO |  | existing | Timestamps |

**New columns**

- **`legal_name`, `ntn`, `strn`**
  - *Why:* a registered supplier's sales tax invoice shows these, and input tax (tax paid on purchases) can only be claimed against them.
  - *Benefit:* purchase tax reports and supplier statements carry the right identity.
  - *Without it:* purchase invoices can't be tied to a registered supplier for tax claims.
- **`payment_terms_days`**
  - *Why:* "Net 15" as text can't be calculated.
  - *Benefit:* a posted purchase invoice gets its `due_date` automatically, so overdue bills can be listed.
  - *Without it:* due dates are typed by hand or not at all, and nobody is warned before a payment is late.
- **`opening_balance`**
  - *Why:* stores join with existing debts to their suppliers.
  - *Benefit:* the supplier balance starts correct on day one (posted as the first ledger entry).
  - *Without it:* every supplier balance is wrong by the old amount, forever.

```sql
ALTER TABLE suppliers
  ADD COLUMN legal_name         VARCHAR(255)  NULL AFTER name,
  ADD COLUMN ntn                VARCHAR(50)   NULL AFTER legal_name,
  ADD COLUMN strn               VARCHAR(50)   NULL AFTER ntn,
  ADD COLUMN payment_terms_days INT           NOT NULL DEFAULT 0 AFTER payment_terms,
  ADD COLUMN opening_balance    DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER payment_terms_days;
```

---

### 1.8 `supplier_ledger`

**Why it changes:** the ledger is the running account with each supplier. Today an entry can only
point to a stock movement, so it can't say which bill, return or payment it belongs to.

Sign convention (unchanged): **`credit` = we owe the supplier more** (purchase invoice, opening balance) ·
**`debit` = we owe less** (payment, return).

| Column | Type | Null | Default | Status | Purpose |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID | existing | Row id |
| `store_id` / `store_id_int` | CHAR(36) / INT | NO |  | existing | Store |
| `ledger_number` | INT | NO |  | existing | Short id per store |
| `location_id` | CHAR(36) | YES |  | existing | Location |
| `supplier_id` | CHAR(36) | NO |  | existing | Supplier |
| `entry_type` | ENUM(debit, credit) | NO |  | existing | Direction (see above) |
| `amount` | DECIMAL(12,2) | NO |  | existing | Amount |
| **`balance_after`** | DECIMAL(12,2) | NO | 0 | **NEW** | What we owe this supplier after this entry |
| **`purchase_invoice_id`** | CHAR(36) | YES |  | **NEW** | Bill it belongs to (FK purchase_invoices.id) |
| **`purchase_return_id`** | CHAR(36) | YES |  | **NEW** | Return it belongs to (FK purchase_returns.id) |
| **`supplier_payment_id`** | CHAR(36) | YES |  | **NEW** | Payment it belongs to (FK supplier_payments.id) |
| **`reference_number`** | VARCHAR(100) | YES |  | **NEW** | Supplier's bill no. / cheque no. |
| `due_date` | DATE | YES |  | existing | When it falls due |
| `paid_at` | DATETIME | YES |  | existing | When it was paid |
| `stock_movement_id` | CHAR(36) | YES |  | existing | Old link to a movement (kept for old rows) |
| **`status`** | ENUM(posted, reversed) | NO | posted | **NEW** | Reversed entries stay visible but don't count |
| **`reversal_of_id`** | CHAR(36) | YES |  | **NEW** | The entry this one reverses |
| `note` | TEXT | YES |  | existing | Note |
| `created_by` | CHAR(36) | YES |  | existing | Staff member |
| `is_pos_visible` / `is_web_visible` / `channel` | | NO |  | existing | Visibility |
| `created_at` | DATETIME | NO |  | existing | Timestamp |

**New columns**

- **`balance_after`**
  - *Why:* a supplier statement shows the balance after each line.
  - *Benefit:* statements and "how much do we owe" are instant and checkable line by line.
  - *Without it:* every balance is a full re-sum of history, and a wrong entry is hard to locate.
- **`purchase_invoice_id`, `purchase_return_id`, `supplier_payment_id`**
  - *Why:* each entry comes from exactly one document.
  - *Benefit:* clicking a ledger line opens the bill, return or payment behind it; duplicates are detectable.
  - *Without it:* the ledger is a list of amounts with no proof of where they came from.
- **`reference_number`**
  - *Why:* suppliers talk in their own bill numbers.
  - *Benefit:* match their statement against ours.
  - *Without it:* reconciling with the supplier means comparing amounts and dates by hand.
- **`status`, `reversal_of_id`**
  - *Why:* a financial entry should never be deleted.
  - *Benefit:* a mistake is undone with an opposite entry, and the audit trail stays complete.
  - *Without it:* fixing an error means deleting or editing history, which hides fraud and breaks balances.

```sql
ALTER TABLE supplier_ledger
  ADD COLUMN balance_after       DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER amount,
  ADD COLUMN purchase_invoice_id CHAR(36)     NULL AFTER balance_after,
  ADD COLUMN purchase_return_id  CHAR(36)     NULL AFTER purchase_invoice_id,
  ADD COLUMN supplier_payment_id CHAR(36)     NULL AFTER purchase_return_id,
  ADD COLUMN reference_number    VARCHAR(100) NULL AFTER supplier_payment_id,
  ADD COLUMN status              ENUM('posted','reversed') NOT NULL DEFAULT 'posted' AFTER stock_movement_id,
  ADD COLUMN reversal_of_id      CHAR(36)     NULL AFTER status;
```

Backfill: compute `balance_after` per supplier in `created_at` order (+credit, −debit).

---

### 1.9 `stock_transfers` (becomes the transfer header)

**Why it changes:** one transfer must carry many products (lines move to `stock_transfer_items`), and
record who approved, sent and received it.

| Column | Type | Null | Default | Status | Purpose |
|---|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID | existing | Row id |
| `store_id` | CHAR(36) | NO |  | existing | Store |
| **`store_id_int`** | INT | NO |  | **NEW** | Store number (every other store table has it) |
| `transfer_number` | INT | NO |  | existing | Short id per store |
| `from_location_id` | CHAR(36) | NO |  | existing | Source location |
| `to_location_id` | CHAR(36) | NO |  | existing | Destination location |
| `product_id` | CHAR(36) | **YES** |  | **CHANGED** | Old single-product transfers only; new transfers use items |
| `qty` | DECIMAL(12,4) | **YES** |  | **CHANGED** | Old single-product transfers only |
| `status` | ENUM(pending, on_the_way, completed, cancelled) | NO | on_the_way | existing | pending = requested, on_the_way = sent, completed = received |
| `note` | TEXT | YES |  | existing | Note |
| `created_by` | CHAR(36) | YES |  | existing | Who requested it |
| **`approved_by`** | CHAR(36) | YES |  | **NEW** | Who approved it |
| **`approved_at`** | DATETIME | YES |  | **NEW** | When |
| **`dispatched_by`** | CHAR(36) | YES |  | **NEW** | Who sent it |
| **`dispatched_at`** | DATETIME | YES |  | **NEW** | When it left |
| **`received_by`** | CHAR(36) | YES |  | **NEW** | Who received it |
| **`received_at`** | DATETIME | YES |  | **NEW** | When it arrived |
| `created_at` / `updated_at` | DATETIME | NO |  | existing | Timestamps |

**New / changed columns**

- **`product_id`, `qty` → nullable**
  - *Why:* lines move to `stock_transfer_items`; the old columns stay for old rows until they are migrated.
  - *Without this change:* every new transfer would still be forced to one product.
- **`store_id_int`**
  - *Why:* consistency with every other store table.
  - *Benefit:* reports filter by store number without a join.
- **`approved_by/at`, `dispatched_by/at`, `received_by/at`**
  - *Why:* stock in transit is the most common place for goods to go missing.
  - *Benefit:* each step has a named person and a time; a short delivery shows who sent and who received.
  - *Without it:* when stock goes missing between branches, nobody is accountable.

```sql
ALTER TABLE stock_transfers
  ADD COLUMN store_id_int  INT      NULL AFTER store_id,
  MODIFY COLUMN product_id CHAR(36)      NULL,
  MODIFY COLUMN qty        DECIMAL(12,4) NULL,
  ADD COLUMN approved_by   CHAR(36) NULL AFTER created_by,
  ADD COLUMN approved_at   DATETIME NULL AFTER approved_by,
  ADD COLUMN dispatched_by CHAR(36) NULL AFTER approved_at,
  ADD COLUMN dispatched_at DATETIME NULL AFTER dispatched_by,
  ADD COLUMN received_by   CHAR(36) NULL AFTER dispatched_at,
  ADD COLUMN received_at   DATETIME NULL AFTER received_by;
-- backfill store_id_int from stores, then make it NOT NULL;
-- copy each old row's product_id / qty into stock_transfer_items.
```

---

## 2. New tables

### 2.1 `product_barcodes`

**Why this table:** one product often has several barcodes: a second supplier's code, the old and
new packaging, or a carton barcode that should count as 12 units.

- **Benefit:** any of them scans to the right product and quantity.
- **Without it:** the cashier can't scan the carton or the other supplier's code, so they type the product in by hand or create duplicate products.

| Column | Type | Null | Default | Purpose |
|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID | Row id |
| `store_id` | CHAR(36) | NO |  | Store (FK stores.id) |
| `store_id_int` | INT | NO |  | Store number |
| `product_id` | CHAR(36) | NO |  | Product (FK products.id) |
| `barcode` | VARCHAR(100) | NO |  | The barcode (unique per store, across `products.barcode` too — checked in code) |
| `units_per_scan` | DECIMAL(12,4) | NO | 1 | Units added per scan (carton barcode = 12) |
| `label` | VARCHAR(100) | YES |  | e.g. "Carton", "Supplier B" |
| `created_at` / `updated_at` | DATETIME | NO |  | Timestamps |

```sql
CREATE TABLE product_barcodes (
  id             CHAR(36)      NOT NULL,
  store_id       CHAR(36)      NOT NULL,
  store_id_int   INT           NOT NULL,
  product_id     CHAR(36)      NOT NULL,
  barcode        VARCHAR(100)  NOT NULL,
  units_per_scan DECIMAL(12,4) NOT NULL DEFAULT 1,
  label          VARCHAR(100)  NULL,
  created_at     DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at     DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY product_barcodes_store_barcode (store_id, barcode),
  KEY product_barcodes_product (product_id),
  CONSTRAINT product_barcodes_store_fkey   FOREIGN KEY (store_id)   REFERENCES stores (id)   ON DELETE CASCADE,
  CONSTRAINT product_barcodes_product_fkey FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
);
```

---

### 2.2 `product_batches`

**Why this table:** the core fix for expiry. Each delivery of a batch product becomes its own row with
its own expiry, cost and quantity, per location.

- **Benefit:** expiry alerts per batch, "sell the oldest first", expired stock written off batch by batch, and recall by batch number.
- **Without it:** a second delivery overwrites the first one's expiry; expired items stay hidden inside the total; cost per batch is lost.

| Column | Type | Null | Default | Purpose |
|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID | Row id |
| `store_id` | CHAR(36) | NO |  | Store |
| `store_id_int` | INT | NO |  | Store number |
| `location_id` | CHAR(36) | NO |  | Location holding it |
| `location_id_int` | INT | NO |  | Location number |
| `product_id` | CHAR(36) | NO |  | Product |
| `batch_number` | VARCHAR(100) | NO |  | Lot / batch no. (supplier's, or generated) |
| `manufacture_date` | DATE | YES |  | Made on |
| `expiry_date` | DATE | YES |  | Expires on |
| `unit_cost` | DECIMAL(12,4) | NO | 0 | Cost per unit for this batch |
| `qty_received` | DECIMAL(12,4) | NO | 0 | Quantity that came in |
| `qty_on_hand` | DECIMAL(12,4) | NO | 0 | Quantity left |
| `supplier_id` | CHAR(36) | YES |  | Supplier |
| `purchase_invoice_id` | CHAR(36) | YES |  | Bill it arrived on |
| `status` | ENUM(active, expired, quarantined, depleted) | NO | active | depleted = sold out, quarantined = held back (damaged / recalled) |
| `created_at` / `updated_at` | DATETIME | NO |  | Timestamps |

Rule: `product_stocks.qty` for a batch product = sum of `qty_on_hand` of its active batches at that
location, updated in the same transaction as the batch.

```sql
CREATE TABLE product_batches (
  id                  CHAR(36)      NOT NULL,
  store_id            CHAR(36)      NOT NULL,
  store_id_int        INT           NOT NULL,
  location_id         CHAR(36)      NOT NULL,
  location_id_int     INT           NOT NULL,
  product_id          CHAR(36)      NOT NULL,
  batch_number        VARCHAR(100)  NOT NULL,
  manufacture_date    DATE          NULL,
  expiry_date         DATE          NULL,
  unit_cost           DECIMAL(12,4) NOT NULL DEFAULT 0,
  qty_received        DECIMAL(12,4) NOT NULL DEFAULT 0,
  qty_on_hand         DECIMAL(12,4) NOT NULL DEFAULT 0,
  supplier_id         CHAR(36)      NULL,
  purchase_invoice_id CHAR(36)      NULL,
  status              ENUM('active','expired','quarantined','depleted') NOT NULL DEFAULT 'active',
  created_at          DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at          DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY product_batches_unique (store_id, location_id, product_id, batch_number),
  KEY product_batches_expiry (store_id, location_id, status, expiry_date),
  CONSTRAINT product_batches_store_fkey    FOREIGN KEY (store_id)    REFERENCES stores (id)    ON DELETE CASCADE,
  CONSTRAINT product_batches_location_fkey FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE,
  CONSTRAINT product_batches_product_fkey  FOREIGN KEY (product_id)  REFERENCES products (id)  ON DELETE CASCADE,
  CONSTRAINT product_batches_supplier_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE SET NULL
);
```

---

### 2.3 `purchase_invoices`

**Why this table:** the supplier's bill. In phase 1 one posted purchase invoice means "goods received
and billed".

Posting it does all of the following in one transaction:
- adds stock (one `stock_in` / `purchase` movement per line, `source_type` = `purchase_invoice`)
- creates batches for batch products
- updates `average_cost`
- writes a `credit` entry in `supplier_ledger`

- **Benefit:** every purchase has a document with the supplier's bill no., due date, totals and tax, and the supplier balance stays correct.
- **Without it:** a purchase is just stock going up. There is no record of what we owe, when it's due, how much tax we paid on purchases, or proof of the delivery.

| Column | Type | Null | Default | Purpose |
|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID | Row id |
| `store_id` / `store_id_int` | CHAR(36) / INT | NO |  | Store |
| `location_id` / `location_id_int` | CHAR(36) / INT | NO |  | Location receiving the goods |
| `invoice_number` | INT | NO |  | Our short id per store |
| `supplier_id` | CHAR(36) | NO |  | Supplier |
| `supplier_invoice_number` | VARCHAR(100) | YES |  | The supplier's bill no. (unique per supplier when given) |
| `invoice_date` | DATE | NO |  | Bill date |
| `due_date` | DATE | YES |  | invoice_date + supplier's `payment_terms_days` |
| `status` | ENUM(draft, posted, cancelled) | NO | draft | Only `posted` moves stock and money |
| `payment_status` | ENUM(unpaid, partially_paid, paid) | NO | unpaid | From allocations |
| `subtotal` | DECIMAL(12,2) | NO | 0 | Sum of lines before discount and tax |
| `discount_amount` | DECIMAL(12,2) | NO | 0 | Bill discount |
| `tax_amount` | DECIMAL(12,2) | NO | 0 | Tax on the bill (input tax) |
| `other_charges` | DECIMAL(12,2) | NO | 0 | Freight / loading |
| `grand_total` | DECIMAL(12,2) | NO | 0 | What we owe for this bill |
| `amount_paid` | DECIMAL(12,2) | NO | 0 | Paid so far (sum of allocations) |
| `notes` | TEXT | YES |  | Notes |
| `attachment_url` | TEXT | YES |  | Photo / PDF of the supplier's bill |
| `created_by` | CHAR(36) | YES |  | Staff who entered it |
| `posted_by` | CHAR(36) | YES |  | Staff who posted it |
| `posted_at` | DATETIME | YES |  | When stock and ledger were updated |
| `cancelled_by` / `cancelled_at` | CHAR(36) / DATETIME | YES |  | Cancellation (posts reversing movements and a ledger reversal) |
| `created_at` / `updated_at` | DATETIME | NO |  | Timestamps |

```sql
CREATE TABLE purchase_invoices (
  id                      CHAR(36)      NOT NULL,
  store_id                CHAR(36)      NOT NULL,
  store_id_int            INT           NOT NULL,
  location_id             CHAR(36)      NOT NULL,
  location_id_int         INT           NOT NULL,
  invoice_number          INT           NOT NULL,
  supplier_id             CHAR(36)      NOT NULL,
  supplier_invoice_number VARCHAR(100)  NULL,
  invoice_date            DATE          NOT NULL,
  due_date                DATE          NULL,
  status                  ENUM('draft','posted','cancelled') NOT NULL DEFAULT 'draft',
  payment_status          ENUM('unpaid','partially_paid','paid') NOT NULL DEFAULT 'unpaid',
  subtotal                DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount              DECIMAL(12,2) NOT NULL DEFAULT 0,
  other_charges           DECIMAL(12,2) NOT NULL DEFAULT 0,
  grand_total             DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount_paid             DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes                   TEXT          NULL,
  attachment_url          TEXT          NULL,
  created_by              CHAR(36)      NULL,
  posted_by               CHAR(36)      NULL,
  posted_at               DATETIME      NULL,
  cancelled_by            CHAR(36)      NULL,
  cancelled_at            DATETIME      NULL,
  created_at              DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at              DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY purchase_invoices_number (store_id, invoice_number),
  UNIQUE KEY purchase_invoices_supplier_ref (store_id, supplier_id, supplier_invoice_number),
  KEY purchase_invoices_due (store_id, payment_status, due_date),
  CONSTRAINT purchase_invoices_store_fkey    FOREIGN KEY (store_id)    REFERENCES stores (id)    ON DELETE CASCADE,
  CONSTRAINT purchase_invoices_location_fkey FOREIGN KEY (location_id) REFERENCES locations (id),
  CONSTRAINT purchase_invoices_supplier_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers (id)
);
```

---

### 2.4 `purchase_invoice_items`

**Why this table:** the lines of a supplier bill, which can differ from the catalog's cost and from
what was ordered.

- **Benefit:** exact cost per product per purchase (feeds `average_cost` and the batch's `unit_cost`), and a line-by-line copy of the bill.
- **Without it:** the bill has only totals, so stock cost can't be updated per product.

| Column | Type | Null | Default | Purpose |
|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID | Row id |
| `purchase_invoice_id` | CHAR(36) | NO |  | Bill |
| `item_number` | INT | NO |  | Line number on the bill |
| `product_id` | CHAR(36) | NO |  | Product |
| `batch_number` | VARCHAR(100) | YES |  | Batch no. (batch products) |
| `expiry_date` | DATE | YES |  | Batch expiry (batch products) |
| `batch_id` | CHAR(36) | YES |  | Batch created on posting |
| `title` | VARCHAR(255) | NO |  | Product name at purchase time |
| `qty` | DECIMAL(12,4) | NO |  | Units received (packs × pack_size for pack products) |
| `unit_cost` | DECIMAL(12,4) | NO |  | Cost per unit on the bill |
| `discount_amount` | DECIMAL(12,2) | NO | 0 | Line discount |
| `tax_amount` | DECIMAL(12,2) | NO | 0 | Line tax |
| `line_total` | DECIMAL(12,2) | NO |  | qty × unit_cost − discount + tax |

```sql
CREATE TABLE purchase_invoice_items (
  id                  CHAR(36)      NOT NULL,
  purchase_invoice_id CHAR(36)      NOT NULL,
  item_number         INT           NOT NULL,
  product_id          CHAR(36)      NOT NULL,
  batch_number        VARCHAR(100)  NULL,
  expiry_date         DATE          NULL,
  batch_id            CHAR(36)      NULL,
  title               VARCHAR(255)  NOT NULL,
  qty                 DECIMAL(12,4) NOT NULL,
  unit_cost           DECIMAL(12,4) NOT NULL,
  discount_amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_total          DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY purchase_invoice_items_line (purchase_invoice_id, item_number),
  CONSTRAINT pii_invoice_fkey FOREIGN KEY (purchase_invoice_id) REFERENCES purchase_invoices (id) ON DELETE CASCADE,
  CONSTRAINT pii_product_fkey FOREIGN KEY (product_id)          REFERENCES products (id),
  CONSTRAINT pii_batch_fkey   FOREIGN KEY (batch_id)            REFERENCES product_batches (id) ON DELETE SET NULL
);
```

---

### 2.5 `purchase_returns`

**Why this table:** sending damaged, expired or wrong goods back to the supplier.

Posting it does all of the following in one transaction:
- takes the stock out (`stock_out` / `return_to_supplier`, `source_type` = `purchase_return`)
- reduces the batch
- writes a `debit` (we owe less) in `supplier_ledger`

- **Benefit:** a return is a document the supplier can sign, and stock and the supplier balance both go down correctly.
- **Without it:** returns are a manual `stock_out` with no effect on what we owe — the supplier is paid for goods we sent back.

| Column | Type | Null | Default | Purpose |
|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID | Row id |
| `store_id` / `store_id_int` | CHAR(36) / INT | NO |  | Store |
| `location_id` / `location_id_int` | CHAR(36) / INT | NO |  | Location sending it back |
| `return_number` | INT | NO |  | Short id per store |
| `supplier_id` | CHAR(36) | NO |  | Supplier |
| `purchase_invoice_id` | CHAR(36) | YES |  | Bill the goods came on |
| `return_date` | DATE | NO |  | Date |
| `status` | ENUM(draft, posted, cancelled) | NO | draft | Only `posted` moves stock and money |
| `reason` | VARCHAR(255) | YES |  | damaged / expired / wrong item |
| `total_amount` | DECIMAL(12,2) | NO | 0 | Value credited by the supplier |
| `created_by` / `posted_by` | CHAR(36) | YES |  | Staff |
| `posted_at` | DATETIME | YES |  | When posted |
| `created_at` / `updated_at` | DATETIME | NO |  | Timestamps |

```sql
CREATE TABLE purchase_returns (
  id                  CHAR(36)      NOT NULL,
  store_id            CHAR(36)      NOT NULL,
  store_id_int        INT           NOT NULL,
  location_id         CHAR(36)      NOT NULL,
  location_id_int     INT           NOT NULL,
  return_number       INT           NOT NULL,
  supplier_id         CHAR(36)      NOT NULL,
  purchase_invoice_id CHAR(36)      NULL,
  return_date         DATE          NOT NULL,
  status              ENUM('draft','posted','cancelled') NOT NULL DEFAULT 'draft',
  reason              VARCHAR(255)  NULL,
  total_amount        DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_by          CHAR(36)      NULL,
  posted_by           CHAR(36)      NULL,
  posted_at           DATETIME      NULL,
  created_at          DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at          DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY purchase_returns_number (store_id, return_number),
  CONSTRAINT purchase_returns_store_fkey    FOREIGN KEY (store_id)            REFERENCES stores (id) ON DELETE CASCADE,
  CONSTRAINT purchase_returns_supplier_fkey FOREIGN KEY (supplier_id)         REFERENCES suppliers (id),
  CONSTRAINT purchase_returns_invoice_fkey  FOREIGN KEY (purchase_invoice_id) REFERENCES purchase_invoices (id) ON DELETE SET NULL
);
```

---

### 2.6 `purchase_return_items`

**Why this table:** which products, batches and quantities went back.

- **Benefit:** the exact batch is reduced and the credited value is per line.
- **Without it:** the return has a total but stock can't be reduced per product or batch.

| Column | Type | Null | Default | Purpose |
|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID | Row id |
| `purchase_return_id` | CHAR(36) | NO |  | Return |
| `item_number` | INT | NO |  | Line number |
| `product_id` | CHAR(36) | NO |  | Product |
| `batch_id` | CHAR(36) | YES |  | Batch returned |
| `qty` | DECIMAL(12,4) | NO |  | Units returned |
| `unit_cost` | DECIMAL(12,4) | NO |  | Credit per unit |
| `tax_amount` | DECIMAL(12,2) | NO | 0 | Tax reversed |
| `line_total` | DECIMAL(12,2) | NO |  | qty × unit_cost + tax |
| `reason` | VARCHAR(255) | YES |  | Line reason |

```sql
CREATE TABLE purchase_return_items (
  id                 CHAR(36)      NOT NULL,
  purchase_return_id CHAR(36)      NOT NULL,
  item_number        INT           NOT NULL,
  product_id         CHAR(36)      NOT NULL,
  batch_id           CHAR(36)      NULL,
  qty                DECIMAL(12,4) NOT NULL,
  unit_cost          DECIMAL(12,4) NOT NULL,
  tax_amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_total         DECIMAL(12,2) NOT NULL,
  reason             VARCHAR(255)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY purchase_return_items_line (purchase_return_id, item_number),
  CONSTRAINT pri_return_fkey  FOREIGN KEY (purchase_return_id) REFERENCES purchase_returns (id) ON DELETE CASCADE,
  CONSTRAINT pri_product_fkey FOREIGN KEY (product_id)         REFERENCES products (id),
  CONSTRAINT pri_batch_fkey   FOREIGN KEY (batch_id)           REFERENCES product_batches (id) ON DELETE SET NULL
);
```

---

### 2.7 `supplier_payments`

**Why this table:** money paid to a supplier is its own document. One payment can clear several bills,
or a bill can be paid in parts. Posting writes a `debit` in `supplier_ledger`.

- **Benefit:** payment history per supplier with method and reference (cheque no., Raast ref), and an accurate outstanding balance.
- **Without it:** payments are loose ledger lines that can't be shown against the bills they paid, so overdue bills can't be identified.

| Column | Type | Null | Default | Purpose |
|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID | Row id |
| `store_id` / `store_id_int` | CHAR(36) / INT | NO |  | Store |
| `location_id` / `location_id_int` | CHAR(36) / INT | YES |  | Branch that paid (cash from a branch) |
| `payment_number` | INT | NO |  | Short id per store |
| `supplier_id` | CHAR(36) | NO |  | Supplier |
| `payment_date` | DATETIME | NO |  | When paid |
| `method` | ENUM(cash, bank_transfer, raast, cheque, card, jazzcash, easypaisa, other) | NO |  | How |
| `amount` | DECIMAL(12,2) | NO |  | Amount |
| `unallocated_amount` | DECIMAL(12,2) | NO | 0 | Advance not yet matched to a bill |
| `reference_number` | VARCHAR(150) | YES |  | Cheque no. / bank ref |
| `register_session_id` | CHAR(36) | YES |  | Batch it was paid from, when cash came out of the drawer |
| `status` | ENUM(draft, posted, void) | NO | draft | Only `posted` affects the balance |
| `notes` | TEXT | YES |  | Notes |
| `created_by` / `posted_by` | CHAR(36) | YES |  | Staff |
| `posted_at` | DATETIME | YES |  | When posted |
| `created_at` / `updated_at` | DATETIME | NO |  | Timestamps |

```sql
CREATE TABLE supplier_payments (
  id                  CHAR(36)      NOT NULL,
  store_id            CHAR(36)      NOT NULL,
  store_id_int        INT           NOT NULL,
  location_id         CHAR(36)      NULL,
  location_id_int     INT           NULL,
  payment_number      INT           NOT NULL,
  supplier_id         CHAR(36)      NOT NULL,
  payment_date        DATETIME      NOT NULL,
  method              ENUM('cash','bank_transfer','raast','cheque','card','jazzcash','easypaisa','other') NOT NULL,
  amount              DECIMAL(12,2) NOT NULL,
  unallocated_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,
  reference_number    VARCHAR(150)  NULL,
  register_session_id CHAR(36)      NULL,
  status              ENUM('draft','posted','void') NOT NULL DEFAULT 'draft',
  notes               TEXT          NULL,
  created_by          CHAR(36)      NULL,
  posted_by           CHAR(36)      NULL,
  posted_at           DATETIME      NULL,
  created_at          DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at          DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY supplier_payments_number (store_id, payment_number),
  KEY supplier_payments_supplier_date (store_id, supplier_id, payment_date),
  CONSTRAINT supplier_payments_store_fkey    FOREIGN KEY (store_id)            REFERENCES stores (id) ON DELETE CASCADE,
  CONSTRAINT supplier_payments_supplier_fkey FOREIGN KEY (supplier_id)         REFERENCES suppliers (id),
  CONSTRAINT supplier_payments_session_fkey  FOREIGN KEY (register_session_id) REFERENCES register_sessions (id) ON DELETE SET NULL
);
```

**Cash from the drawer:** when `method` = `cash` and `register_session_id` is set, posting also adds
the amount to that batch's `cash_out`. Otherwise the drawer would be short by that amount at batch closing.

---

### 2.8 `supplier_payment_allocations`

**Why this table:** which bill(s) a payment settled, and how much of each.

- **Benefit:** each bill's `amount_paid` / `payment_status` is the sum of its allocations, so "unpaid / overdue bills" is exact.
- **Without it:** we know the supplier's total balance but not which bills are still open, and suppliers dispute which invoice was paid.

| Column | Type | Null | Default | Purpose |
|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID | Row id |
| `store_id` | CHAR(36) | NO |  | Store |
| `supplier_payment_id` | CHAR(36) | NO |  | Payment |
| `purchase_invoice_id` | CHAR(36) | NO |  | Bill it pays |
| `amount` | DECIMAL(12,2) | NO |  | Part of the payment applied to this bill |
| `created_at` | DATETIME | NO |  | Timestamp |

```sql
CREATE TABLE supplier_payment_allocations (
  id                  CHAR(36)      NOT NULL,
  store_id            CHAR(36)      NOT NULL,
  supplier_payment_id CHAR(36)      NOT NULL,
  purchase_invoice_id CHAR(36)      NOT NULL,
  amount              DECIMAL(12,2) NOT NULL,
  created_at          DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY spa_payment_invoice (supplier_payment_id, purchase_invoice_id),
  KEY spa_invoice (purchase_invoice_id),
  CONSTRAINT spa_payment_fkey FOREIGN KEY (supplier_payment_id) REFERENCES supplier_payments (id) ON DELETE CASCADE,
  CONSTRAINT spa_invoice_fkey FOREIGN KEY (purchase_invoice_id) REFERENCES purchase_invoices (id)
);
```

Rule: the allocations of a payment never exceed its `amount`, and those of a bill never exceed its
`grand_total`.

---

### 2.9 `expense_categories`

**Why this table:** fixed headings for spending: rent, electricity, salaries, internet, transport,
repairs, and so on.

- **Benefit:** expense reports by heading and month, with the same names every time.
- **Without it:** free-text headings ("bijli", "Electricity", "K-Electric") split the same cost into many lines.

| Column | Type | Null | Default | Purpose |
|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID | Row id |
| `store_id` / `store_id_int` | CHAR(36) / INT | NO |  | Store |
| `category_number` | INT | NO |  | Short id per store |
| `name` | VARCHAR(120) | NO |  | Heading name |
| `description` | VARCHAR(255) | YES |  | Description |
| `is_active` | TINYINT(1) | NO | 1 | false = hidden |
| `created_at` / `updated_at` | DATETIME | NO |  | Timestamps |

```sql
CREATE TABLE expense_categories (
  id              CHAR(36)     NOT NULL,
  store_id        CHAR(36)     NOT NULL,
  store_id_int    INT          NOT NULL,
  category_number INT          NOT NULL,
  name            VARCHAR(120) NOT NULL,
  description     VARCHAR(255) NULL,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY expense_categories_number (store_id, category_number),
  CONSTRAINT expense_categories_store_fkey FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
);
```

---

### 2.10 `expenses`

**Why this table:** money the business spends that is not stock.

- **Benefit:** real profit = sales − cost of goods − expenses, per branch and month. Cash expenses paid from the drawer also explain the batch's cash.
- **Without it:** reports show gross profit as if it were profit, and cash taken out for bills looks like a shortage at batch closing.

| Column | Type | Null | Default | Purpose |
|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID | Row id |
| `store_id` / `store_id_int` | CHAR(36) / INT | NO |  | Store |
| `location_id` / `location_id_int` | CHAR(36) / INT | YES |  | Branch (null = whole store) |
| `expense_number` | INT | NO |  | Short id per store |
| `expense_category_id` | CHAR(36) | NO |  | Heading |
| `expense_date` | DATETIME | NO |  | When spent |
| `description` | VARCHAR(500) | NO |  | What for |
| `amount` | DECIMAL(12,2) | NO |  | Amount (including tax) |
| `tax_amount` | DECIMAL(12,2) | NO | 0 | Tax part (e.g. on a utility bill) |
| `method` | ENUM(cash, bank_transfer, raast, cheque, card, jazzcash, easypaisa, other) | NO |  | How paid |
| `reference_number` | VARCHAR(150) | YES |  | Bill / cheque / transaction no. |
| `supplier_id` | CHAR(36) | YES |  | Paid to a known supplier |
| `register_session_id` | CHAR(36) | YES |  | Batch it was paid from, when cash came out of the drawer |
| `attachment_url` | TEXT | YES |  | Photo of the bill / receipt |
| `status` | ENUM(posted, void) | NO | posted | Void instead of delete |
| `created_by` | CHAR(36) | YES |  | Staff |
| `voided_by` / `voided_at` | CHAR(36) / DATETIME | YES |  | Void |
| `created_at` / `updated_at` | DATETIME | NO |  | Timestamps |

```sql
CREATE TABLE expenses (
  id                  CHAR(36)      NOT NULL,
  store_id            CHAR(36)      NOT NULL,
  store_id_int        INT           NOT NULL,
  location_id         CHAR(36)      NULL,
  location_id_int     INT           NULL,
  expense_number      INT           NOT NULL,
  expense_category_id CHAR(36)      NOT NULL,
  expense_date        DATETIME      NOT NULL,
  description         VARCHAR(500)  NOT NULL,
  amount              DECIMAL(12,2) NOT NULL,
  tax_amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
  method              ENUM('cash','bank_transfer','raast','cheque','card','jazzcash','easypaisa','other') NOT NULL,
  reference_number    VARCHAR(150)  NULL,
  supplier_id         CHAR(36)      NULL,
  register_session_id CHAR(36)      NULL,
  attachment_url      TEXT          NULL,
  status              ENUM('posted','void') NOT NULL DEFAULT 'posted',
  created_by          CHAR(36)      NULL,
  voided_by           CHAR(36)      NULL,
  voided_at           DATETIME      NULL,
  created_at          DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at          DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY expenses_number (store_id, expense_number),
  KEY expenses_date (store_id, expense_date, status),
  CONSTRAINT expenses_store_fkey    FOREIGN KEY (store_id)            REFERENCES stores (id) ON DELETE CASCADE,
  CONSTRAINT expenses_category_fkey FOREIGN KEY (expense_category_id) REFERENCES expense_categories (id),
  CONSTRAINT expenses_supplier_fkey FOREIGN KEY (supplier_id)         REFERENCES suppliers (id) ON DELETE SET NULL,
  CONSTRAINT expenses_session_fkey  FOREIGN KEY (register_session_id) REFERENCES register_sessions (id) ON DELETE SET NULL
);
```

**Cash from the drawer:** a cash expense with `register_session_id` adds its amount to that batch's
`cash_out`, so the expected cash at batch closing stays right.

---

### 2.11 `stock_transfer_items`

**Why this table:** the lines of a transfer (header = `stock_transfers`).

- **Benefit:** many products per transfer, and sent vs received quantity per line, so a short delivery is visible exactly.
- **Without it:** moving 20 products to a branch means 20 separate transfers, and a missing carton can't be pinned to a line.

| Column | Type | Null | Default | Purpose |
|---|---|---|---|---|
| `id` | CHAR(36) | NO | UUID | Row id |
| `stock_transfer_id` | CHAR(36) | NO |  | Transfer |
| `item_number` | INT | NO |  | Line number |
| `product_id` | CHAR(36) | NO |  | Product |
| `batch_id` | CHAR(36) | YES |  | Batch sent (batch products) |
| `qty_requested` | DECIMAL(12,4) | NO |  | Asked for |
| `qty_dispatched` | DECIMAL(12,4) | NO | 0 | Sent (stock leaves the source) |
| `qty_received` | DECIMAL(12,4) | NO | 0 | Arrived (stock enters the destination) |
| `unit_cost` | DECIMAL(12,4) | YES |  | Source cost per unit (carries cost to the branch) |
| `note` | VARCHAR(255) | YES |  | e.g. "2 broken in transit" |

```sql
CREATE TABLE stock_transfer_items (
  id                CHAR(36)      NOT NULL,
  stock_transfer_id CHAR(36)      NOT NULL,
  item_number       INT           NOT NULL,
  product_id        CHAR(36)      NOT NULL,
  batch_id          CHAR(36)      NULL,
  qty_requested     DECIMAL(12,4) NOT NULL,
  qty_dispatched    DECIMAL(12,4) NOT NULL DEFAULT 0,
  qty_received      DECIMAL(12,4) NOT NULL DEFAULT 0,
  unit_cost         DECIMAL(12,4) NULL,
  note              VARCHAR(255)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY stock_transfer_items_line (stock_transfer_id, item_number),
  CONSTRAINT sti_transfer_fkey FOREIGN KEY (stock_transfer_id) REFERENCES stock_transfers (id) ON DELETE CASCADE,
  CONSTRAINT sti_product_fkey  FOREIGN KEY (product_id)        REFERENCES products (id),
  CONSTRAINT sti_batch_fkey    FOREIGN KEY (batch_id)          REFERENCES product_batches (id) ON DELETE SET NULL
);
```

---

## 3. Migration order

1. **Additive columns first** (safe, no code change needed): `products`, `product_stocks`,
   `stock_movements`, `orders`, `order_items`, `payments`, `suppliers`, `supplier_ledger`,
   `stock_transfers`. Payment method enums go in together in `orders`, `payments`,
   `payment_method_tax_rates` and `PAYMENT_METHOD`.
2. **New tables** in dependency order:
   1. `product_barcodes`
   2. `product_batches`
   3. `purchase_invoices` → `purchase_invoice_items`
   4. `purchase_returns` → `purchase_return_items`
   5. `supplier_payments` → `supplier_payment_allocations`
   6. `expense_categories` → `expenses`
   7. `stock_transfer_items`
   8. then the FKs from `stock_movements.batch_id`, `order_items.batch_id` and the new `supplier_ledger` links.
3. **Backfills:**
   - `stock_transfers.store_id_int`
   - one `stock_transfer_items` row per old transfer
   - `supplier_ledger.balance_after`
   - `product_stocks.average_cost` = `products.cost_price` as the starting value
4. **New counters** (`*_number`): `purchase_invoice`, `purchase_return`, `supplier_payment`,
   `expense_category`, `expense` — per store, like the existing ones.
5. Like every migration so far, each step checks before it changes anything, so `ensureSchema` can
   run it on start without a manual SQL step on Railway.
