import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { noTimestamps, uuidCol, uuidPk } from "../../db/columnTypes.js"

export const OrderRefundItem = sequelize.define(
  "OrderRefundItem",
  {
    id: uuidPk(),
    refund_id: uuidCol(false),
    order_item_id: uuidCol(false),
    product_id: uuidCol(true),
    title: { type: DataTypes.TEXT, allowNull: false },
    quantity: { type: DataTypes.DECIMAL(12, 4), allowNull: false },
    unit_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    tax_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    subtotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  },
  { ...noTimestamps, tableName: "order_refund_items" }
)
