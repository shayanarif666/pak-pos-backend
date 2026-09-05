import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { noTimestamps, uuidCol, uuidPk } from "../../db/columnTypes.js"

export const CartItem = sequelize.define(
  "CartItem",
  {
    id: uuidPk(),
    cart_id: uuidCol(false),
    product_id: uuidCol(false),
    quantity: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: 1 },
    weight: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
  },
  {
    ...noTimestamps,
    tableName: "cart_items",
    indexes: [{ unique: true, fields: ["cart_id", "product_id"] }],
  }
)
