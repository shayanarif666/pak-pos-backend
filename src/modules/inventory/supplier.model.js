import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { catalogChannelVisibilityFields } from "../../db/channelVisibility.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { SUPPLIER_LOCATION_SCOPE } from "../../db/enums.js"

export const Supplier = sequelize.define(
  "Supplier",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.TEXT, allowNull: false },
    phone: { type: DataTypes.STRING(64), allowNull: true },
    email: { type: DataTypes.STRING(255), allowNull: true },
    address: { type: DataTypes.TEXT, allowNull: true },
    payment_terms: { type: DataTypes.TEXT, allowNull: true },
    location_scope: {
      type: DataTypes.ENUM(...SUPPLIER_LOCATION_SCOPE),
      allowNull: false,
      defaultValue: "all",
    },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    ...catalogChannelVisibilityFields(),
  },
  { ...modelOptions, tableName: "suppliers" }
)
