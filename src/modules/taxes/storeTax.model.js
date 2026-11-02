import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, noTimestamps, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { SUPPLIER_LOCATION_SCOPE, TAX_AMOUNT_TYPE } from "../../db/enums.js"

/**
 * A store tax: defined once, applied to every product (product_scope "all") or to the products in
 * store_tax_products ("selected"). A fixed value is per unit; it applies on the discounted price.
 */
export const StoreTax = sequelize.define(
  "StoreTax",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    tax_number: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING(255), allowNull: false },
    type: { type: DataTypes.ENUM(...TAX_AMOUNT_TYPE), allowNull: false },
    value: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    product_scope: { type: DataTypes.ENUM(...SUPPLIER_LOCATION_SCOPE), allowNull: false, defaultValue: "all" },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_by: uuidCol(true),
  },
  {
    ...modelOptions,
    tableName: "store_taxes",
    indexes: [{ unique: true, fields: ["store_id", "tax_number"] }],
  }
)

/** A product (or variant) a "selected" store tax applies to. A product covers its variants. */
export const StoreTaxProduct = sequelize.define(
  "StoreTaxProduct",
  {
    id: uuidPk(),
    tax_id: uuidCol(false),
    product_id: uuidCol(false),
  },
  {
    ...noTimestamps,
    tableName: "store_tax_products",
    indexes: [{ unique: true, fields: ["tax_id", "product_id"] }],
  }
)
