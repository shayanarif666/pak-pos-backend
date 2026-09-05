import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { LICENSE_STATUS } from "../../db/enums.js"

export const StoreLicense = sequelize.define(
  "StoreLicense",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    plan_id: uuidCol(false),
    license_key: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    status: {
      type: DataTypes.ENUM(...LICENSE_STATUS),
      allowNull: false,
      defaultValue: "pending",
    },
    device_id: uuidCol(true),
    starts_at: { type: DataTypes.DATE, allowNull: false },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    revoked_at: { type: DataTypes.DATE, allowNull: true },
    revoked_reason: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    ...modelOptions,
    tableName: "store_licenses",
    indexes: [{ fields: ["status", "expires_at"] }],
  }
)
