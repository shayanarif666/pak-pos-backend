import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"

export const UserSession = sequelize.define(
  "UserSession",
  {
    id: uuidPk(),
    user_id: uuidCol(false),
    refresh_token_hash: { type: DataTypes.TEXT, allowNull: true },
    channel: { type: DataTypes.STRING(16), allowNull: true },
    device_id: uuidCol(true),
    license_id: uuidCol(true),
    ip_address: { type: DataTypes.STRING(64), allowNull: true },
    user_agent: { type: DataTypes.TEXT, allowNull: true },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    revoked_at: { type: DataTypes.DATE, allowNull: true },
  },
  { ...modelOptions, tableName: "user_sessions" }
)
