import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { createdOnly, uuidCol, uuidPk } from "../../db/columnTypes.js"

export const StoreBackup = sequelize.define(
  "StoreBackup",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    file_url: { type: DataTypes.TEXT, allowNull: true },
    note: { type: DataTypes.TEXT, allowNull: true },
    created_by: uuidCol(true),
  },
  { ...createdOnly, tableName: "store_backups" }
)
