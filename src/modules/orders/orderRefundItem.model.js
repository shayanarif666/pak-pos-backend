import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { saleChannelVisibilityFields } from "../../db/channelVisibility.js"
import { noTimestamps, uuidCol, uuidPk } from "../../db/columnTypes.js"

export const OrderRefundItem = sequelize.define(
  "OrderRefundItem",
  {
    id: uuidPk(),
    refund_id: uuidCol(false),
    // Per-refund line number (1,2,3...).
    item_number: { type: DataTypes.INTEGER, allowNull: false },
    ...saleChannelVisibilityFields(),
    order_item_id: uuidCol(false),
    product_id: uuidCol(true),
    title: { type: DataTypes.TEXT, allowNull: false },
    quantity: { type: DataTypes.DECIMAL(12, 4), allowNull: false },
    unit_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    tax_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    subtotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    // POS refunds: the discount on the qty given back, its taxes as sent, and whether it was restocked.
    discount_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    line_taxes: { type: DataTypes.JSON, allowNull: true },
    restocked: { type: DataTypes.BOOLEAN, allowNull: true },
  },
  {
    ...noTimestamps,
    tableName: "order_refund_items",
    indexes: [{ unique: true, fields: ["refund_id", "item_number"] }],
  }
)
