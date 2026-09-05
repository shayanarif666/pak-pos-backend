import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"

export const Address = sequelize.define(
  "Address",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    user_id: uuidCol(false),
    name: { type: DataTypes.TEXT, allowNull: false },
    phone: { type: DataTypes.STRING(64), allowNull: false },
    address_line: { type: DataTypes.TEXT, allowNull: false },
    city: { type: DataTypes.TEXT, allowNull: false },
    postal_code: { type: DataTypes.STRING(32), allowNull: true },
    is_default: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  { ...modelOptions, tableName: "addresses" }
)
