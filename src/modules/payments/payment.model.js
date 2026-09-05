import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { PAYMENT_METHOD, PAYMENT_ROW_STATUS } from "../../db/enums.js"

export const Payment = sequelize.define(
  "Payment",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    location_id: uuidCol(true),
    location_id_int: { type: DataTypes.INTEGER, allowNull: true },
    order_id: uuidCol(false),
    method: { type: DataTypes.ENUM(...PAYMENT_METHOD), allowNull: false },
    amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    tax_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "PKR" },
    status: {
      type: DataTypes.ENUM(...PAYMENT_ROW_STATUS),
      allowNull: false,
      defaultValue: "initiated",
    },
    gateway_transaction_id: { type: DataTypes.STRING(255), allowNull: true },
    idempotency_key: { type: DataTypes.STRING(255), allowNull: true },
    raw_payload: { type: DataTypes.JSON, allowNull: true },
    paid_at: { type: DataTypes.DATE, allowNull: true },
    failure_reason: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    ...modelOptions,
    tableName: "payments",
    indexes: [{ unique: true, fields: ["store_id", "gateway_transaction_id"] }],
  }
)
