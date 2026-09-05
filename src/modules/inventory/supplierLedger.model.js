import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { createdOnly, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { LEDGER_ENTRY_TYPE } from "../../db/enums.js"

export const SupplierLedger = sequelize.define(
  "SupplierLedger",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    location_id: uuidCol(true),
    supplier_id: uuidCol(false),
    entry_type: { type: DataTypes.ENUM(...LEDGER_ENTRY_TYPE), allowNull: false },
    amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    due_date: { type: DataTypes.DATEONLY, allowNull: true },
    paid_at: { type: DataTypes.DATE, allowNull: true },
    stock_movement_id: uuidCol(true),
    note: { type: DataTypes.TEXT, allowNull: true },
    created_by: uuidCol(true),
  },
  { ...createdOnly, tableName: "supplier_ledger" }
)
