import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { createdOnly, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { catalogChannelVisibilityFields } from "../../db/channelVisibility.js"
import { STOCK_MOVEMENT_REASON, STOCK_MOVEMENT_TYPE } from "../../db/enums.js"

export const StockMovement = sequelize.define(
  "StockMovement",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    movement_number: { type: DataTypes.INTEGER, allowNull: false },
    location_id: uuidCol(false),
    location_id_int: { type: DataTypes.INTEGER, allowNull: false },
    product_id: uuidCol(false),
    movement_type: { type: DataTypes.ENUM(...STOCK_MOVEMENT_TYPE), allowNull: false },
    reason: { type: DataTypes.ENUM(...STOCK_MOVEMENT_REASON), allowNull: false },
    reason_note: { type: DataTypes.TEXT, allowNull: true },
    qty: { type: DataTypes.DECIMAL(12, 4), allowNull: false },
    qty_after: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
    // product_stocks.unit_sold right after this movement (running total of units sold).
    unit_sold: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
    supplier_id: uuidCol(true),
    staff_id: uuidCol(true),
    order_id: uuidCol(true),
    // The lot(s) it moved: lot_id when one, lots = [{ lot_id, lot_number, qty, expiry_date }].
    lot_id: uuidCol(true),
    lots: { type: DataTypes.JSON, allowNull: true },
    ...catalogChannelVisibilityFields(),
    // Set when the movement is edited from the dashboard (null = never edited).
    updated_at: { type: DataTypes.DATE, allowNull: true },
    deleted_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    ...createdOnly,
    tableName: "stock_movements",
    // Soft delete: destroy() sets deleted_at and every query (lists, reports, totals) leaves it out.
    paranoid: true,
    deletedAt: "deleted_at",
    indexes: [
      { fields: ["store_id", "product_id", "created_at"] },
      { unique: true, fields: ["store_id", "movement_number"] },
    ],
  }
)
