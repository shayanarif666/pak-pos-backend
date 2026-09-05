import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { noTimestamps, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { PRODUCT_UNIT } from "../../db/enums.js"

export const OrderItem = sequelize.define(
  "OrderItem",
  {
    id: uuidPk(),
    order_id: uuidCol(false),
    product_id: uuidCol(true),
    title: { type: DataTypes.TEXT, allowNull: false },
    sku: { type: DataTypes.STRING(255), allowNull: true },
    barcode: { type: DataTypes.STRING(255), allowNull: true },
    unit: { type: DataTypes.ENUM(...PRODUCT_UNIT), allowNull: true },
    is_weight_based: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    weight: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
    qty_packs: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
    unit_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    cost_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    quantity: { type: DataTypes.DECIMAL(12, 4), allowNull: false },
    discount_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    tax_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    subtotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  },
  { ...noTimestamps, tableName: "order_items" }
)
