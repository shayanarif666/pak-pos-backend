import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { createdOnly, uuidCol, uuidPk } from "../../db/columnTypes.js"

export const CouponRedemption = sequelize.define(
  "CouponRedemption",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    coupon_id: uuidCol(false),
    order_id: uuidCol(false),
    user_id: uuidCol(true),
    amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  },
  {
    ...createdOnly,
    tableName: "coupon_redemptions",
    indexes: [{ unique: true, fields: ["coupon_id", "order_id"] }],
  }
)
