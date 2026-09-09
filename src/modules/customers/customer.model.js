import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"

export const Customer = sequelize.define(
  "Customer",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    location_id: uuidCol(true),
    user_id: uuidCol(true),
    name: { type: DataTypes.TEXT, allowNull: false },
    email: { type: DataTypes.STRING(255), allowNull: true },
    phone: { type: DataTypes.STRING(64), allowNull: true },
    total_debt: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    remaining_debt: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    debt_notes: { type: DataTypes.TEXT, allowNull: true },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  {
    ...modelOptions,
    tableName: "customers",
    indexes: [{ fields: ["store_id", "phone"] }],
  }
)
