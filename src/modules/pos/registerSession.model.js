import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { REGISTER_SESSION_STATUS } from "../../db/enums.js"

export const RegisterSession = sequelize.define(
  "RegisterSession",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    location_id: uuidCol(false),
    location_id_int: { type: DataTypes.INTEGER, allowNull: false },
    cashier_id: uuidCol(false),
    device_id: uuidCol(true),
    status: {
      type: DataTypes.ENUM(...REGISTER_SESSION_STATUS),
      allowNull: false,
      defaultValue: "clock_in",
    },
    opening_cash: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    cash_in: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    cash_out: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    cash_sales: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    card_sales: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    jazzcash_sales: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    easypaisa_sales: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    total_sales: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    net_sales: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    expected_cash: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    note_5000_count: { type: DataTypes.INTEGER, allowNull: true },
    note_1000_count: { type: DataTypes.INTEGER, allowNull: true },
    note_500_count: { type: DataTypes.INTEGER, allowNull: true },
    note_100_count: { type: DataTypes.INTEGER, allowNull: true },
    note_50_count: { type: DataTypes.INTEGER, allowNull: true },
    note_20_count: { type: DataTypes.INTEGER, allowNull: true },
    coins_total: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    counted_cash: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    closing_cash: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    cash_variance: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    note: { type: DataTypes.TEXT, allowNull: true },
    opened_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    closed_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    ...modelOptions,
    tableName: "register_sessions",
    indexes: [{ fields: ["store_id", "location_id", "status"] }],
  }
)
