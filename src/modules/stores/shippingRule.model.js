import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"

export const ShippingRule = sequelize.define(
  "ShippingRule",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    flat_fee: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    free_over_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
  },
  {
    ...modelOptions,
    tableName: "shipping_rules",
    indexes: [{ unique: true, fields: ["store_id"] }],
  }
)
