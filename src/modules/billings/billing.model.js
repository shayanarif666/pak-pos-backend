import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { BILLING_STATUS } from "../../db/enums.js"

export const Billing = sequelize.define(
  "Billing",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    plan_id: uuidCol(false),
    amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    currency: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "PKR" },
    status: {
      type: DataTypes.ENUM(...BILLING_STATUS),
      allowNull: false,
      defaultValue: "pending",
    },
    period_start: { type: DataTypes.DATE, allowNull: false },
    period_end: { type: DataTypes.DATE, allowNull: false },
    paid_at: { type: DataTypes.DATE, allowNull: true },
    method_note: { type: DataTypes.STRING(255), allowNull: true },
    note: { type: DataTypes.TEXT, allowNull: true },
    created_by: uuidCol(true),
  },
  { ...modelOptions, tableName: "billings" }
)
