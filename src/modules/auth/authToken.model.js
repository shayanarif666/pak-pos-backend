import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { createdOnly, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { AUTH_TOKEN_TYPE } from "../../db/enums.js"

export const AuthToken = sequelize.define(
  "AuthToken",
  {
    id: uuidPk(),
    user_id: uuidCol(false),
    type: { type: DataTypes.ENUM(...AUTH_TOKEN_TYPE), allowNull: false },
    token_hash: { type: DataTypes.TEXT, allowNull: false },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    used_at: { type: DataTypes.DATE, allowNull: true },
  },
  { ...createdOnly, tableName: "auth_tokens" }
)
