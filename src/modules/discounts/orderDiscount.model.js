import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { DISCOUNT_TYPE } from "../../db/enums.js"

/** A discount on the whole order: name, type, amount. The cashier picks it on an order. */
export const OrderDiscount = sequelize.define(
  "OrderDiscount",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    discount_number: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.TEXT, allowNull: false },
    discount_type: { type: DataTypes.ENUM(...DISCOUNT_TYPE), allowNull: false },
    discount_value: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_by: uuidCol(true),
    deleted_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    ...modelOptions,
    tableName: "order_discounts",
    paranoid: true,
    deletedAt: "deleted_at",
    indexes: [{ unique: true, fields: ["store_id", "discount_number"] }],
  }
)
