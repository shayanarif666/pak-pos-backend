import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { TRANSFER_STATUS } from "../../db/enums.js"

/** One product sent to one destination within a stock transfer (the transfer is the shipment). */
export const StockTransferItem = sequelize.define(
  "StockTransferItem",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    transfer_id: uuidCol(false),
    // 1, 2, 3… within the transfer.
    item_number: { type: DataTypes.INTEGER, allowNull: false },
    to_location_id: uuidCol(false),
    product_id: uuidCol(false),
    qty: { type: DataTypes.DECIMAL(12, 4), allowNull: false },
    // What arrived (null until received; less than qty = short on the way).
    received_qty: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
    // Why part of it did not arrive (received_qty less than qty): damaged, lost on the way…
    loss_reason_note: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.ENUM(...TRANSFER_STATUS), allowNull: false, defaultValue: "on_the_way" },
    received_at: { type: DataTypes.DATE, allowNull: true },
    received_by: uuidCol(true),
    // The lots this line left from (and arrived as): [{ lot_id, lot_number, qty, expiry_date }].
    lots: { type: DataTypes.JSON, allowNull: true },
  },
  {
    ...modelOptions,
    tableName: "stock_transfer_items",
    indexes: [{ unique: true, fields: ["transfer_id", "item_number"] }],
  }
)
