import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { APPROVAL_STATUS, APPROVAL_TYPE } from "../../db/enums.js"

export const ApprovalRequest = sequelize.define(
  "ApprovalRequest",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    location_id: uuidCol(false),
    type: { type: DataTypes.ENUM(...APPROVAL_TYPE), allowNull: false },
    status: {
      type: DataTypes.ENUM(...APPROVAL_STATUS),
      allowNull: false,
      defaultValue: "pending",
    },
    requested_by: uuidCol(false),
    reviewed_by: uuidCol(true),
    order_id: uuidCol(true),
    payload: { type: DataTypes.JSON, allowNull: true },
    reason: { type: DataTypes.TEXT, allowNull: true },
    review_note: { type: DataTypes.TEXT, allowNull: true },
  },
  { ...modelOptions, tableName: "approval_requests" }
)
