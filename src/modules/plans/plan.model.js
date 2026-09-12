import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidPk } from "../../db/columnTypes.js"
import { PLAN_TYPE } from "../../db/enums.js"

export const Plan = sequelize.define(
  "Plan",
  {
    id: uuidPk(),
    code: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    type: {
      type: DataTypes.ENUM(...PLAN_TYPE),
      allowNull: false,
      defaultValue: "monthly",
    },
    name: { type: DataTypes.STRING(255), allowNull: false },
    price_pkr: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    max_devices: { type: DataTypes.INTEGER, allowNull: false },
    max_locations: { type: DataTypes.INTEGER, allowNull: false },
    features: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
      get() {
        const value = this.getDataValue("features")
        if (Array.isArray(value)) return value
        if (typeof value === "string") {
          try {
            const parsed = JSON.parse(value)
            return Array.isArray(parsed) ? parsed : []
          } catch {
            return []
          }
        }
        return []
      },
    },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  { ...modelOptions, tableName: "plans" }
)
