import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"

export const ProductStock = sequelize.define(
  "ProductStock",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    location_id: uuidCol(false),
    location_id_int: { type: DataTypes.INTEGER, allowNull: false },
    product_id: uuidCol(false),
    qty: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
    low_stock_threshold: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
  },
  {
    ...modelOptions,
    tableName: "product_stocks",
    indexes: [
      { unique: true, fields: ["location_id", "product_id"] },
      { fields: ["store_id", "location_id"] },
      { fields: ["location_id", "qty"] },
    ],
  }
)
