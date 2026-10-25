import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { STAFF_SESSION_STATUS } from "../../db/enums.js"

/**
 * Staff attendance: one row from clock in until clock out. Separate from the cash drawer
 * (register_sessions = batch opening / closing).
 */
export const StaffSession = sequelize.define(
  "StaffSession",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    // Per-store sequence (1,2,3...) — the id the POS sees.
    session_number: { type: DataTypes.INTEGER, allowNull: false },
    location_id: uuidCol(true),
    location_id_int: { type: DataTypes.INTEGER, allowNull: true },
    user_id: uuidCol(false),
    device_id: uuidCol(true),
    status: {
      type: DataTypes.ENUM(...STAFF_SESSION_STATUS),
      allowNull: false,
      defaultValue: "clock_in",
    },
    clock_in_at: { type: DataTypes.DATE, allowNull: false },
    clock_out_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    ...modelOptions,
    tableName: "staff_sessions",
    indexes: [
      { unique: true, fields: ["store_id", "session_number"] },
      { fields: ["store_id", "user_id", "status"] },
    ],
  }
)
