import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { createdOnly, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { LEDGER_ENTRY_TYPE } from "../../db/enums.js"

export const CustomerCreditEntry = sequelize.define(
  "CustomerCreditEntry",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    customer_id: uuidCol(false),
    order_id: uuidCol(true),
    entry_type: { type: DataTypes.ENUM(...LEDGER_ENTRY_TYPE), allowNull: false },
    amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    due_date: { type: DataTypes.DATEONLY, allowNull: true },
    note: { type: DataTypes.TEXT, allowNull: true },
    created_by: uuidCol(true),
  },
  { ...createdOnly, tableName: "customer_credit_entries" }
)
