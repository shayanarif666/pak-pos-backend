import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { USER_ROLE } from "../../db/enums.js"

export const User = sequelize.define(
  "User",
  {
    id: uuidPk(),
    store_id: uuidCol(true),
    store_id_int: { type: DataTypes.INTEGER, allowNull: true },
    location_id: uuidCol(true),
    location_id_int: { type: DataTypes.INTEGER, allowNull: true },
    name: { type: DataTypes.TEXT, allowNull: false },
    email: { type: DataTypes.STRING(255), allowNull: false },
    password: { type: DataTypes.TEXT, allowNull: false },
    pin: { type: DataTypes.STRING(32), allowNull: true },
    phone: { type: DataTypes.STRING(64), allowNull: true },
    role: { type: DataTypes.ENUM(...USER_ROLE), allowNull: false },
    is_verified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    last_login_at: { type: DataTypes.DATE, allowNull: true },
    refresh_token_hash: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    ...modelOptions,
    tableName: "users",
    indexes: [
      { unique: true, fields: ["store_id", "email"] },
      { unique: true, fields: ["store_id", "pin"] },
      { fields: ["store_id", "role"] },
      { fields: ["store_id", "location_id"] },
    ],
  }
)
