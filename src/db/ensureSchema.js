import { sequelize } from "./sequelize.js"
import { logger } from "../config/logger.js"
import * as productImagesFeatured from "./migrations/20260923120000-product-images-featured.js"
import * as authTokenVersionDomainUnique from "./migrations/20261002120000-auth-token-version-domain-unique.js"
import * as userSessions from "./migrations/20261002130000-user-sessions.js"
import * as licenseSuspendExtend from "./migrations/20261004120000-license-suspend-extend.js"
import * as posDeviceOptionalLocation from "./migrations/20261004130000-pos-device-optional-location.js"
import * as supplierLocations from "./migrations/20261006120000-supplier-locations.js"
import * as reportLocationIndexes from "./migrations/20261006130000-report-location-indexes.js"
import * as catalogPricingFields from "./migrations/20261018120000-catalog-pricing-fields.js"
import * as productTotalPrices from "./migrations/20261019120000-product-total-prices.js"
import * as userPinPerLocation from "./migrations/20261020120000-user-pin-per-location.js"
import * as userClockStatus from "./migrations/20261021120000-user-clock-status.js"
import * as offerLocations from "./migrations/20261022120000-offer-locations.js"
import * as posWorkflowV2 from "./migrations/20261024120000-pos-workflow-v2.js"
import * as taxV2 from "./migrations/20261025120000-tax-v2.js"
import * as salesTaxToggle from "./migrations/20261025130000-sales-tax-toggle.js"
import * as currencies from "./migrations/20261026120000-currencies.js"
import * as refundType from "./migrations/20261027120000-refund-type.js"
import * as transactionNumber from "./migrations/20261028120000-transaction-number.js"
import * as refundPayments from "./migrations/20261029120000-refund-payments.js"
import * as transferReceivedQty from "./migrations/20261030120000-transfer-received-qty.js"
import * as orderItemOffers from "./migrations/20261031120000-order-item-offers.js"
import * as orderStatusV2 from "./migrations/20261101120000-order-status-v2.js"
import * as numberColumns from "./migrations/20261102120000-number-columns.js"
import * as catalogLocations from "./migrations/20261103120000-catalog-locations.js"
import * as offerApplyMixed from "./migrations/20261104120000-offer-apply-mixed.js"
import * as stockTransferItems from "./migrations/20261104130000-stock-transfer-items.js"
import * as productVariants from "./migrations/20261105120000-product-variants.js"
import * as variantTaxes from "./migrations/20261106120000-variant-taxes.js"
import * as variantNumberStockScope from "./migrations/20261107120000-variant-number-stock-scope.js"
import * as offerSaleUnits from "./migrations/20261108120000-offer-sale-units.js"
import * as storeTaxes from "./migrations/20261109120000-store-taxes.js"
import * as paymentSurcharges from "./migrations/20261110120000-payment-surcharges.js"
import * as morePaymentMethods from "./migrations/20261111120000-more-payment-methods.js"
import * as softDelete from "./migrations/20261114120000-soft-delete-staff-sessions-batches.js"
import * as softDeleteStock from "./migrations/20261115120000-soft-delete-stock.js"
import * as softDeleteTransfers from "./migrations/20261116120000-soft-delete-transfers.js"
import * as softDeleteOffersLocations from "./migrations/20261117120000-soft-delete-offers-locations.js"
import * as posFiguresOrdersRefunds from "./migrations/20261118120000-pos-figures-orders-refunds.js"
import * as softDeleteSuppliers from "./migrations/20261119120000-soft-delete-suppliers.js"
import * as stockLots from "./migrations/20261120120000-stock-lots.js"
import * as productVariantLotNumbers from "./migrations/20261121120000-product-variant-lot-numbers.js"
import * as productColors from "./migrations/20261122120000-product-colors.js"
import * as softDeleteVariants from "./migrations/20261123120000-soft-delete-variants.js"
import * as discountLevels from "./migrations/20261124120000-discount-levels.js"
import * as stockLotSupplier from "./migrations/20261125120000-stock-lot-supplier.js"
import * as lowStockUnit from "./migrations/20261126120000-low-stock-unit.js"
import * as variantParentLowStockZero from "./migrations/20261127120000-variant-parent-low-stock-zero.js"
import * as bulkBundleDiscounts from "./migrations/20261128120000-bulk-bundle-discounts.js"

// Migrations the running code cannot work without (e.g. users.token_version is read on every
// authenticated request). Each one checks before it changes anything, so running it on a
// database that already has the change is a no-op. Deploys that only run `npm start` used to
// skip `db:migrate`, which left production failing with "Unknown column 'token_version'".
const REQUIRED = [
  // The short numbers every reply uses (a fresh database lacks them; first, others build on them).
  numberColumns,
  productImagesFeatured,
  authTokenVersionDomainUnique,
  userSessions,
  licenseSuspendExtend,
  posDeviceOptionalLocation,
  supplierLocations,
  // Not required for correctness, but cheap: InnoDB builds these online, and Railway's query
  // editor cannot run CREATE INDEX (it appends LIMIT 100), so the server adds them on start.
  reportLocationIndexes,
  // The Product/Category models read pack pricing and tax/discount names.
  catalogPricingFields,
  // The Product model reads total_price_each_unit / total_pack_price.
  productTotalPrices,
  // Without it the old (store_id, pin) index rejects a PIN reused at another location.
  userPinPerLocation,
  // The User model reads status (clock_in / clock_out) on every request.
  userClockStatus,
  // The Offer model reads location_scope and its offer_locations.
  offerLocations,
  // Trial/active, plan features, staff_sessions, batches, unit_sold, custom_category.
  posWorkflowV2,
  // Sales tax / product taxes list / payment GST switch (the models read the new columns).
  taxV2,
  // stores.sales_tax_enabled (sales tax on / off, default 18%).
  salesTaxToggle,
  // The store currency table (PKR by default).
  currencies,
  // order_refunds.refund_type (complete | partial) for the refund history.
  refundType,
  // payments.transaction_number (the transaction id the POS sees).
  transactionNumber,
  // order_refunds.payments (how each refund was paid back, per method).
  refundPayments,
  // stock_transfers.received_qty (partial receive).
  transferReceivedQty,
  // order_items category / discount source / offers / free_qty, orders.offer_exempt.
  orderItemOffers,
  // partial_refunded / partial statuses, order line discount snapshots.
  orderStatusV2,
  // categories / products location_scope and their category_locations / product_locations.
  catalogLocations,
  // offers.apply_to "mixed" (products and categories in one offer).
  offerApplyMixed,
  // stock_transfer_items: several products to several locations in one transfer.
  stockTransferItems,
  // products.parent_product_id / variant_name / has_variants (product variants).
  productVariants,
  // products.variant_taxes (a variant's own taxes on top of its parent's).
  variantTaxes,
  // products.variant_number (1, 2, 3… per product) and stock_scope / stock_location_ids.
  variantNumberStockScope,
  // Offers / sales of pack products: unit, pack or both (offers, offer_targets, order_items).
  offerSaleUnits,
  // store_taxes / store_tax_products (a tax for every product or the selected ones).
  storeTaxes,
  // payment_method_surcharges (replace the payment-method GST rates).
  paymentSurcharges,
  // Every payment method (bank transfer, Raast, the wallets, cheque…) on orders, payments and settings.
  morePaymentMethods,
  // users / staff_sessions / register_sessions.deleted_at (soft delete; the models read it).
  softDelete,
  // stock_movements.deleted_at / updated_at, product_stocks.deleted_at (edit & soft delete of stock).
  softDeleteStock,
  // stock_transfers.deleted_at (soft delete of a transfer whose stock has not moved).
  softDeleteTransfers,
  // offers.deleted_at / locations.deleted_at (soft delete of a discount / a branch).
  softDeleteOffersLocations,
  // The POS figures of orders and refunds kept as sent (receipt number, line taxes, refund lines).
  posFiguresOrdersRefunds,
  // suppliers.deleted_at (soft delete of a supplier).
  softDeleteSuppliers,
  // stock_lots (stock in lots, each with its own expiry; stock out takes the soonest first).
  stockLots,
  // Product numbers count products only (not variants); lot numbers 1, 2, 3… per product.
  productVariantLotNumbers,
  // products.colors: the colours a product / variant comes in, as hex codes.
  productColors,
  // products.deleted_at: soft delete of a variant (history stays).
  softDeleteVariants,
  // The five discount levels: offers discarded, order_discounts, bundle_discounts, products.discount_applies_to.
  discountLevels,
  // stock_lots.supplier_id: the supplier a lot came from (another supplier = another lot).
  stockLotSupplier,
  // products.low_stock_unit: pack or unit, for a pack + loose product's low stock level.
  lowStockUnit,
  // A product with variants keeps low_stock_threshold 0 (each variant has its own).
  variantParentLowStockZero,
  // bulk_discounts + tiers, bundle components / rewards, no order_discounts.apply_to_all_orders.
  bulkBundleDiscounts,
]

export async function ensureSchema() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS SequelizeMeta (
      name VARCHAR(255) NOT NULL,
      PRIMARY KEY (name)
    ) ENGINE=InnoDB
  `)

  const queryInterface = sequelize.getQueryInterface()
  for (const migration of REQUIRED) {
    const [rows] = await sequelize.query("SELECT name FROM SequelizeMeta WHERE name = ?", {
      replacements: [migration.name],
    })
    if (rows.length) continue

    await migration.up(queryInterface)
    await sequelize.query("INSERT IGNORE INTO SequelizeMeta (name) VALUES (?)", {
      replacements: [migration.name],
    })
    logger.info(`Schema updated: ${migration.name}`)
  }
}
