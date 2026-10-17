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
    image_url: { type: DataTypes.TEXT, allowNull: true },
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
    has_product_discount: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    discount_type: { type: DataTypes.ENUM(...DISCOUNT_TYPE), allowNull: true },
    discount_value: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    has_product_tax: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    tax_type: { type: DataTypes.ENUM(...TAX_AMOUNT_TYPE), allowNull: true },
    tax_value: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
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
    // MySQL STORED GENERATED COLUMN (selling_price minus the product's own discount, no tax) —
    // see the net_selling_price expression in railway_bootstrap.sql / the migration SQL. The DB
    // recomputes it whenever selling_price/discount_type/discount_value change; never assign it
    // from app code — leaving it unset on create/update is what lets the DB compute it.
    net_selling_price: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
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
