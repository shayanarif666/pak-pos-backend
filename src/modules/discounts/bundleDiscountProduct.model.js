import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { noTimestamps, uuidCol, uuidPk } from "../../db/columnTypes.js"

/**
 * A component of a bundle: the product (or the one variant: its own product row) that must be bought,
 * and how many (qty, in sale_unit unit | pack).
 */
export const BundleDiscountProduct = sequelize.define(
  "BundleDiscountProduct",
  {
    id: uuidPk(),
    bundle_id: uuidCol(false),
    product_id: uuidCol(false),
    qty: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: 1 },
    sale_unit: { type: DataTypes.ENUM("unit", "pack"), allowNull: false, defaultValue: "pack" },
  },
  { ...noTimestamps, tableName: "bundle_discount_products" }
)
