# Frontend Calculations (same as backend)

Follow these steps in this exact order so the POS shows the same numbers the backend saves.

**Rounding rule:** `round(x) = Number(x.toFixed(2))`. Round at every step where this file says `round`, not only at the end. Otherwise a paisa can differ.

**Tax switches (from `GET /tax-rates`)**
- `charge_tax_on_sales = false` → no tax of any kind (line tax and payment tax are both 0).
- `sales_tax_enabled = false` → no sales tax.
- `payment_tax_enabled = false` → no payment tax.
- `tax_exempt: true` on an order → no tax of any kind.

---

## Create Order Instructions

### Step 1: Line discount (per product line)

```
list       = product.selling_price
ownDisc    = has_product_discount ? product discount on list : 0
catDisc    = category discount on (list − ownDisc)          ← both apply, one after the other
             percentage → round(base × value / 100)      fixed → value      (never more than base)
unitDisc   = round(ownDisc + catDisc)
discount   = round(unitDisc × qty)
```

Example: 100 Rs, product 5% + category 5% → 5 + 4.75 = 9.75 off → 90.25 per unit.

If a live offer applies (flash sale / promotional / bulk / BOGO), work out the saving of each one. Take **the one that saves the most** and use it instead of the line above. Offers never stack.

- **Flash sale:** `unit = min(list, promo_price)`
- **Promotional / bulk:** `unit = list − discount(list)`, and bulk applies only when `qty ≥ min_qty`
- **BOGO:** `free = floor(qty ÷ (buy+get)) × get`, then `discount = list × free`
- For flash sale, promotional and bulk: `discount = round((list − unit) × qty)`

```
line.subtotal = round(list × qty − discount)
```

Custom item: `subtotal = round(unit_price × qty − discount_amount)`

### Step 2: Order discount (optional, manual)

```
S             = Σ line.subtotal
orderDiscount = percentage → round(S × value / 100)   fixed → value   (max S)
taxableShare  = round((S − orderDiscount) ÷ S)        ← rounded to 2 decimals (e.g. 0.95)
taxable       = orderDiscount > 0 ? round(line.subtotal × taxableShare) : line.subtotal
```

### Step 3: Line taxes (each on `taxable`, no tax on top of tax)

```
productTax  = Σ over product.taxes:   percentage → round(taxable × value / 100)   fixed → round(value × qty)
categoryTax = category tax:           percentage → round(taxable × value / 100)   fixed → round(value × qty)
salesTax    = sales_tax_enabled ? round(taxable × sales_tax_rate / 100) : 0
line.tax_amount = round(productTax + categoryTax + salesTax)
line.total      = line.subtotal + line.tax_amount
```

### Step 4: Coupon (optional)

```
couponDiscount = percentage → round((S − orderDiscount) × value / 100)   fixed → value   (max S − orderDiscount)
```

A coupon does **not** lower tax: tax stays as worked out in Step 3.

### Step 5: Bill before payment tax

```
goods    = round(S − orderDiscount − couponDiscount)
lineTax  = round(Σ line.tax_amount)
shipping = 0 on POS (web only)
preGst   = round(goods + lineTax + shipping)
```

### Step 6: Payment tax and split (`payments[]`)

`rate` = that method's `gst_percent`, or 0 when payment tax is off. The defaults are cash 16, card/jazzcash/easypaisa 5.

Do it in this order:

1. **Card / wallet rows** (the customer tells you the amount):
   ```
   bill_share = round(amount ÷ (1 + rate/100))
   tax        = round(amount − bill_share)
   ```
2. **Rows sent with `bill_share`:** `tax = round(bill_share × rate / 100)`
3. **The rest row** (the first cash row without `bill_share`, or the only row):
   ```
   bill_share = round(preGst − Σ other bill_shares)
   tax        = round(bill_share × rate / 100)
   amount     = round(bill_share + tax)
   ```
4. **Rules**
   - `Σ bill_share` must not be more than `preGst`.
   - Only cash may be overpaid: `change = paid − amount`.
   - Card/wallet `paid` must equal its `amount`.
5. **Udhaar** (the cash handed over is less than the rest row's amount):
   ```
   amount     = paid
   bill_share = round(amount ÷ (1 + rate/100))
   tax        = round(amount − bill_share)
   ```
   The share that is left over becomes credit (no payment tax on it). A customer is required.

### Step 7: Totals

```
paymentTax   = round(Σ row.tax)
tax_amount   = round(lineTax + paymentTax)
total_amount = round(preGst + paymentTax)
credit       = round(total_amount − Σ row.amount)           (udhaar, 0 normally)
change_due   = max(0, Σ paid − total_amount)
```

### Example: Lux 100 × 12 (18% GST) + Pepsi 100 × 1 (5% discount, 18% GST), card 100 + cash 3000

| Step | Lux | Pepsi | Order |
|---|---|---|---|
| subtotal | 1200 | 100 − 5 = 95 | S = 1295 |
| tax 18% | 216 | 17.10 | lineTax = 233.10 |
| line total | 1416 | 112.10 | preGst = 1528.10 |

| Payment | bill_share | tax | amount | paid | change |
|---|---|---|---|---|---|
| card 5% | 100 ÷ 1.05 = 95.24 | 4.76 | 100 | 100 | 0 |
| cash 16% | 1528.10 − 95.24 = 1432.86 | 229.26 | 1662.12 | 3000 | 1337.88 |

**total_amount = 1528.10 + 234.02 = 1762.12**, tax_amount = 233.10 + 234.02 = 467.12

---

## Partial Refund Order Instructions

A refund is **not** priced again from today's price or tax. It is a share of what the customer **actually paid**. Each method gets its own part back, with the same payment tax it was charged.

**What you need**
- The order (`order_items[].qty / subtotal / tax_amount`, `discount_amount`, `payments[].method / amount / payment_tax_percent`, `total_amount`, `payment_gst_amount`)
- The order's earlier refunds, each with `payments[]`: `GET /api/v1/orders/refunds?orderId=3&type=partial` and `&type=complete`

### Step 1: Qty check

```
refundQty ≤ item.qty − qty already refunded on that item
```

### Step 2: Line value before payment tax

```
kept      = (S − orderDiscount − couponDiscount) ÷ S        (1 when there is no order discount or coupon; NOT rounded)
lineValue(item) = item.subtotal × kept + item.tax_amount
```

### Step 3: Refunded fraction F (cumulative: earlier refunds + this one)

```
F = Σ over all items [ lineValue(item) × refundedQtyAfterThis(item) ÷ item.qty ]  ÷  Σ over all items lineValue(item)
```

`refundedQtyAfterThis` = what was already refunded on that item, plus `refundQty` if it is the item being refunded now.

### Step 4: Each method's refund

```
buckets: one per payment method → amount = Σ payments.amount of that method
         + "credit" bucket = total_amount − Σ payments.amount   (udhaar; with no customer it counts as cash)
already  = Σ earlier refunds' payments[].amount of that method  (an older refund with no payments[] = all cash)

refund(method) = max(0, round(bucket.amount × F) − already(method))
paymentTax     = round(refund × p ÷ (100 + p))        p = that method's payment_tax_percent (credit = 0)
bill_share     = round(refund − paymentTax)
```

### Step 5: Refund totals

```
amount (before tax) = round(item.subtotal × kept × refundQty ÷ item.qty)
total               = round(Σ refund(method))
tax                 = round(total − amount)            (product/category/sales tax + payment tax)
```

**Where the money goes**
- The **cash** part comes out of the drawer.
- The **card / wallet** part goes back to the card or wallet.
- The **credit** part is taken off the customer's udhaar.

Because F is cumulative, the paisa lost to rounding on one unit comes back on the next. Once everything has been refunded, each method gets back **exactly** what it paid.

### Example: refund 1 Lux from the order above (nothing refunded before)

```
F = (1416 × 1/12) ÷ 1528.10 = 118 ÷ 1528.10 = 0.077220
```

| Method | bucket | round(bucket × F) | payment tax | bill_share | refund |
|---|---|---|---|---|---|
| card 5% | 100 | 7.72 | 7.72 × 5/105 = 0.37 | 7.35 | 7.72 |
| cash 16% | 1662.12 | 128.35 | 128.35 × 16/116 = 17.70 | 110.65 | 128.35 |

**amount = 100, total = 136.07, tax = 36.07** (product GST 18 + payment tax 18.07)

Short form when there is no order discount and nothing refunded before:

```
refund ≈ unit price after discount × (1 + line tax %) × (total_amount ÷ preGst)
       = 100 × 1.18 × (1762.12 ÷ 1528.10) = 136.07
```
