import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"

export const OrderRefund = sequelize.define(
  "OrderRefund",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    location_id: uuidCol(true),
    location_id_int: { type: DataTypes.INTEGER, allowNull: true },
    order_id: uuidCol(false),
    cashier_id: uuidCol(true),
    receipt_id: uuidCol(true),
    reason: { type: DataTypes.TEXT, allowNull: false },
    amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    tax_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  },
  {
    ...modelOptions,
    tableName: "order_refunds",
    indexes: [{ fields: ["store_id", "order_id"] }],
  }
)
