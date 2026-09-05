import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { DISCOUNT_TYPE } from "../../db/enums.js"

export const ProductBulkTier = sequelize.define(
  "ProductBulkTier",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    product_id: uuidCol(false),
    min_qty: { type: DataTypes.DECIMAL(12, 4), allowNull: false },
    discount_type: { type: DataTypes.ENUM(...DISCOUNT_TYPE), allowNull: false },
    discount_value: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  },
  {
    ...modelOptions,
    tableName: "product_bulk_tiers",
    indexes: [{ unique: true, fields: ["product_id", "min_qty"] }],
  }
)
