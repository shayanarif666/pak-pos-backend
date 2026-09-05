import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidPk } from "../../db/columnTypes.js"
import { PLAN_CODE } from "../../db/enums.js"

export const Plan = sequelize.define(
  "Plan",
  {
    id: uuidPk(),
    code: { type: DataTypes.ENUM(...PLAN_CODE), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    price_pkr: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    max_devices: { type: DataTypes.INTEGER, allowNull: false },
    max_locations: { type: DataTypes.INTEGER, allowNull: false },
    offline_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    pin_override_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    approval_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    advanced_reports: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    backup_restore_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    multi_branch_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    has_dedicated_am: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  { ...modelOptions, tableName: "plans" }
)
