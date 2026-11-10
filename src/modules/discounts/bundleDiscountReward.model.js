import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { noTimestamps, uuidCol, uuidPk } from "../../db/columnTypes.js"

/** A free item of a bundle: the product (or the one variant: its own product row), its qty and unit. */
export const BundleDiscountReward = sequelize.define(
  "BundleDiscountReward",
  {
    id: uuidPk(),
    bundle_id: uuidCol(false),
    product_id: uuidCol(false),
    qty: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: 1 },
    sale_unit: { type: DataTypes.ENUM("unit", "pack"), allowNull: false, defaultValue: "unit" },
  },
  { ...noTimestamps, tableName: "bundle_discount_rewards" }
)
