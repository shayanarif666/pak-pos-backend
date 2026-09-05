import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { DISCOUNT_TYPE } from "../../db/enums.js"

export const Coupon = sequelize.define(
  "Coupon",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    location_id: uuidCol(true),
    code: { type: DataTypes.STRING(64), allowNull: false },
    type: { type: DataTypes.ENUM(...DISCOUNT_TYPE), allowNull: false },
    value: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    min_order_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    start_date: { type: DataTypes.DATE, allowNull: true },
    end_date: { type: DataTypes.DATE, allowNull: true },
    usage_limit: { type: DataTypes.INTEGER, allowNull: true },
    used_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    pos_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    web_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  {
    ...modelOptions,
    tableName: "coupons",
    indexes: [{ unique: true, fields: ["store_id", "code"] }],
  }
)
