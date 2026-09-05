import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { BUSINESS_TYPE } from "../../db/enums.js"

export const Store = sequelize.define(
  "Store",
  {
    id: uuidPk(),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    plan_id: uuidCol(false),
    name: { type: DataTypes.TEXT, allowNull: false },
    slug: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    legal_name: { type: DataTypes.STRING(255), allowNull: true },
    owner_name: { type: DataTypes.STRING(255), allowNull: true },
    business_type: { type: DataTypes.ENUM(...BUSINESS_TYPE), allowNull: false },
    address: { type: DataTypes.TEXT, allowNull: false },
    city: { type: DataTypes.STRING(255), allowNull: true },
    contact_email: { type: DataTypes.STRING(255), allowNull: false },
    contact_phone: { type: DataTypes.STRING(255), allowNull: false },
    logo_url: { type: DataTypes.TEXT, allowNull: true },
    favicon_url: { type: DataTypes.TEXT, allowNull: true },
    currency: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "PKR" },
    timezone: {
      type: DataTypes.STRING(64),
      allowNull: false,
      defaultValue: "Asia/Karachi",
    },
    ntn: { type: DataTypes.STRING(255), allowNull: true },
    strn: { type: DataTypes.STRING(255), allowNull: true },
    fbr_invoice_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    charge_tax_on_sales: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    default_tax_rate: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
    expiry_warning_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 },
    expiry_critical_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 7 },
    receipt_footer: { type: DataTypes.TEXT, allowNull: true },
    pos_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    web_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    admin_id: uuidCol(true),
    default_location_id: uuidCol(true),
    default_location_id_int: { type: DataTypes.INTEGER, allowNull: true },
    account_manager_name: { type: DataTypes.STRING(255), allowNull: true },
    account_manager_phone: { type: DataTypes.STRING(255), allowNull: true },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    is_live: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    suspend_reason: { type: DataTypes.TEXT, allowNull: true },
  },
  { ...modelOptions, tableName: "stores" }
)
