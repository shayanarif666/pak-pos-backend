import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { createdOnly, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { STOCK_MOVEMENT_REASON, STOCK_MOVEMENT_TYPE } from "../../db/enums.js"

export const StockMovement = sequelize.define(
  "StockMovement",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    location_id: uuidCol(false),
    location_id_int: { type: DataTypes.INTEGER, allowNull: false },
    product_id: uuidCol(false),
    movement_type: { type: DataTypes.ENUM(...STOCK_MOVEMENT_TYPE), allowNull: false },
    reason: { type: DataTypes.ENUM(...STOCK_MOVEMENT_REASON), allowNull: false },
    reason_note: { type: DataTypes.TEXT, allowNull: true },
    qty: { type: DataTypes.DECIMAL(12, 4), allowNull: false },
    qty_after: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
    supplier_id: uuidCol(true),
    staff_id: uuidCol(true),
    order_id: uuidCol(true),
  },
  {
    ...createdOnly,
    tableName: "stock_movements",
    indexes: [{ fields: ["store_id", "product_id", "created_at"] }],
  }
)
