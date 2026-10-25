import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidPk } from "../../db/columnTypes.js"
import { PLAN_TYPE, REPORTING_LEVEL } from "../../db/enums.js"

export const Plan = sequelize.define(
  "Plan",
  {
    id: uuidPk(),
    // Short, human-friendly number for client-facing responses (e.g. POS license validation)
    // that shouldn't expose the internal UUID. DB auto-increments it; never set on create.
    plan_number: { type: DataTypes.INTEGER, allowNull: false, unique: true },
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
    // null = no limit on staff accounts.
    max_users: { type: DataTypes.INTEGER, allowNull: true },
    reporting_level: {
      type: DataTypes.ENUM(...REPORTING_LEVEL),
      allowNull: false,
      defaultValue: "basic",
    },
    import_export: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    staff_attendance: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    email_integration: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    whatsapp_integration: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    receipt_customization: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    barcode_scanning: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    batch_management: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    remote_access: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    // Free-text selling points shown on the plan card.
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
