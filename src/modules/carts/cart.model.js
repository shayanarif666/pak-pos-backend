import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"

export const Cart = sequelize.define(
  "Cart",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    user_id: uuidCol(false),
    coupon_code: { type: DataTypes.STRING(64), allowNull: true },
  },
  {
    ...modelOptions,
    tableName: "carts",
    indexes: [{ unique: true, fields: ["store_id", "user_id"] }],
  }
)
