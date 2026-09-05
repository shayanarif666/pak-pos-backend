import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { noTimestamps } from "../../db/columnTypes.js"

export const Counter = sequelize.define(
  "Counter",
  {
    name: { type: DataTypes.STRING(191), primaryKey: true, allowNull: false },
    seq: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  },
  { ...noTimestamps, tableName: "counters" }
)
