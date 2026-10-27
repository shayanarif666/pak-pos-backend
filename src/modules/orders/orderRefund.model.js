import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { saleChannelVisibilityFields } from "../../db/channelVisibility.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"

export const OrderRefund = sequelize.define(
  "OrderRefund",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    refund_number: { type: DataTypes.INTEGER, allowNull: false },
    location_id: uuidCol(true),
    location_id_int: { type: DataTypes.INTEGER, allowNull: true },
    order_id: uuidCol(false),
    cashier_id: uuidCol(true),
    receipt_id: uuidCol(true),
    // complete = the whole order (refund/complete), partial = some of its items.
    refund_type: { type: DataTypes.ENUM("complete", "partial"), allowNull: false, defaultValue: "partial" },
    reason: { type: DataTypes.TEXT, allowNull: false },
    amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    tax_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    // How it was paid back, per method of the sale: [{ method, bill_share, payment_tax_percent,
    // payment_tax_amount, amount }]; method credit = off the udhaar. Null on older (all-cash) refunds.
    payments: { type: DataTypes.JSON, allowNull: true },
    ...saleChannelVisibilityFields(),
  },
  {
    ...modelOptions,
    tableName: "order_refunds",
    indexes: [
      { fields: ["store_id", "order_id"] },
      { unique: true, fields: ["store_id", "refund_number"] },
    ],
  }
)
