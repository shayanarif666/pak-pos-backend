import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { TRANSFER_STATUS } from "../../db/enums.js"

export const StockTransfer = sequelize.define(
  "StockTransfer",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    from_location_id: uuidCol(false),
    to_location_id: uuidCol(false),
    product_id: uuidCol(false),
    qty: { type: DataTypes.DECIMAL(12, 4), allowNull: false },
    status: {
      type: DataTypes.ENUM(...TRANSFER_STATUS),
      allowNull: false,
      defaultValue: "pending",
    },
    note: { type: DataTypes.TEXT, allowNull: true },
    created_by: uuidCol(true),
  },
  { ...modelOptions, tableName: "stock_transfers" }
)
