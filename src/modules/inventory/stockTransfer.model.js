import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { TRANSFER_STATUS } from "../../db/enums.js"

export const StockTransfer = sequelize.define(
  "StockTransfer",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    transfer_number: { type: DataTypes.INTEGER, allowNull: false },
    from_location_id: uuidCol(false),
    // Transfers made before stock_transfer_items keep their one product / destination here; new
    // transfers leave these empty and list every product per destination in their items.
    to_location_id: uuidCol(true),
    product_id: uuidCol(true),
    qty: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
    // What arrived at the destination (null until received; less than qty = short on the way).
    received_qty: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
    status: {
      type: DataTypes.ENUM(...TRANSFER_STATUS),
      allowNull: false,
      defaultValue: "on_the_way",
    },
    note: { type: DataTypes.TEXT, allowNull: true },
    created_by: uuidCol(true),
  },
  {
    ...modelOptions,
    tableName: "stock_transfers",
    indexes: [{ unique: true, fields: ["store_id", "transfer_number"] }],
  }
)
