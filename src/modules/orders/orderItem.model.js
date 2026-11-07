import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { noTimestamps, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { saleChannelVisibilityFields } from "../../db/channelVisibility.js"
import { PRODUCT_UNIT } from "../../db/enums.js"

export const OrderItem = sequelize.define(
  "OrderItem",
  {
    id: uuidPk(),
    order_id: uuidCol(false),
    // Per-order line number (1,2,3...), assigned by position when the order's items are saved.
    item_number: { type: DataTypes.INTEGER, allowNull: false },
    ...saleChannelVisibilityFields(),
    product_id: uuidCol(true),
    title: { type: DataTypes.TEXT, allowNull: false },
    // Custom sale lines only: the category typed at the till (no catalog product behind it).
    custom_category: { type: DataTypes.STRING(255), allowNull: true },
    // Catalog lines: the product's category as it was at the sale.
    category_id: uuidCol(true),
    category_name: { type: DataTypes.STRING(255), allowNull: true },
    sku: { type: DataTypes.STRING(255), allowNull: true },
    barcode: { type: DataTypes.STRING(255), allowNull: true },
    unit: { type: DataTypes.ENUM(...PRODUCT_UNIT), allowNull: true },
    is_weight_based: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    weight: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
    qty_packs: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
    // Sold as single units or by the pack. quantity is always in units; a pack line also keeps the
    // pack size and the price of one pack as sold.
    sale_unit: { type: DataTypes.ENUM("unit", "pack"), allowNull: false, defaultValue: "unit" },
    pack_size: { type: DataTypes.INTEGER, allowNull: true },
    pack_price: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    unit_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    cost_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    quantity: { type: DataTypes.DECIMAL(12, 4), allowNull: false },
    refunded_qty: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
    discount_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    // Where discount_amount came from: none | product | category | product+category | bulk_tier | offer | custom.
    discount_source: { type: DataTypes.STRING(32), allowNull: true },
    // The product / category discount that priced this line, as at the sale: { name, type, value, amount }.
    product_discount: { type: DataTypes.JSON, allowNull: true },
    category_discount: { type: DataTypes.JSON, allowNull: true },
    offer_id: uuidCol(true),
    // The offer(s) that priced this line, as they were at the sale: [{ id, name, type, …, amount }].
    offers: { type: DataTypes.JSON, allowNull: true },
    // BOGO: units given free.
    free_qty: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
    tax_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    product_tax_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    category_tax_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    sales_tax_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    // Snapshot of the product taxes charged on this line: [{ name, type, value, amount }].
    product_taxes: { type: DataTypes.JSON, allowNull: true },
    // Every tax of the line as the POS sent it: [{ level, name, rate, amount }].
    line_taxes: { type: DataTypes.JSON, allowNull: true },
    // The lots this line was taken from: [{ lot_id, lot_number, qty, expiry_date, returned? }].
    lots: { type: DataTypes.JSON, allowNull: true },
    category_tax_type: { type: DataTypes.STRING(32), allowNull: true },
    category_tax_value: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
    category_tax_name: { type: DataTypes.STRING(255), allowNull: true },
    subtotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  },
  {
    ...noTimestamps,
    tableName: "order_items",
    indexes: [{ unique: true, fields: ["order_id", "item_number"] }],
  }
)
