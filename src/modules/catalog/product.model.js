import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { catalogChannelVisibilityFields } from "../../db/channelVisibility.js"
import { DISCOUNT_TYPE, PRODUCT_UNIT, TAX_AMOUNT_TYPE } from "../../db/enums.js"

export const Product = sequelize.define(
  "Product",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    product_number: { type: DataTypes.INTEGER, allowNull: false },
    category_id: uuidCol(false),
    title: { type: DataTypes.TEXT, allowNull: false },
    slug: { type: DataTypes.STRING(255), allowNull: false },
    sku: { type: DataTypes.STRING(255), allowNull: false },
    barcode: { type: DataTypes.STRING(255), allowNull: true },
    images: { type: DataTypes.JSON, allowNull: true, defaultValue: [] },
    featured_image: { type: DataTypes.TEXT, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    unit: {
      type: DataTypes.ENUM(...PRODUCT_UNIT),
      allowNull: false,
      defaultValue: "piece",
    },
    cost_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    selling_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    // Derived on create/update from whether discount_type + discount_value are set, unless the
    // client sends it explicitly. Kept as a column because net_selling_price is generated from it.
    has_product_discount: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    discount_type: { type: DataTypes.ENUM(...DISCOUNT_TYPE), allowNull: true },
    discount_value: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    discount_name: { type: DataTypes.STRING(255), allowNull: true },
    tax_type: { type: DataTypes.ENUM(...TAX_AMOUNT_TYPE), allowNull: true },
    tax_value: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    tax_name: { type: DataTypes.STRING(255), allowNull: true },
    is_pack_product: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    pack_size: { type: DataTypes.INTEGER, allowNull: true },
    // Whole-pack cost/price, independent of cost_price/selling_price × pack_size (bulk purchase/
    // sale economics differ from per-unit). Required when is_pack_product — see assertPackRules.
    pack_cost_price: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    pack_selling_price: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    sell_loose: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    is_weight_based: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    has_bulk_discount: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    low_stock_threshold: {
      type: DataTypes.DECIMAL(12, 4),
      allowNull: false,
      defaultValue: 10,
    },
    // MySQL STORED GENERATED COLUMNS: the price after this product's own discount, then its own
    // tax on the discounted price (e.g. 100 → 5% off → 95 → +5% tax → 99.75). Category tax,
    // offers and store-level tax are applied at checkout, not here. total_pack_price does the
    // same on pack_selling_price (fixed amounts count once per unit in the pack) and is NULL for
    // loose items. Expressions: db/productTotals.sql.js. Never assign these from app code —
    // leaving them unset on create/update is what lets the DB compute them.
    total_price_each_unit: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    total_pack_price: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    is_published: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    ...catalogChannelVisibilityFields(),
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  {
    ...modelOptions,
    tableName: "products",
    indexes: [
      { unique: true, fields: ["store_id", "product_number"] },
      { unique: true, fields: ["store_id", "sku"] },
      { unique: true, fields: ["store_id", "slug"] },
      { unique: true, fields: ["store_id", "barcode"] },
      { fields: ["store_id", "is_published"] },
      { fields: ["store_id", "category_id"] },
    ],
  }
)
