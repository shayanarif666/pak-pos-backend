import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"

export const CURRENCY_DEFAULTS = {
  code: "PKR",
  name: "Pakistani Rupee",
  symbol: "Rs",
  decimal_places: 2,
  symbol_position: "before",
}

// The store's currency (one row per store, created with the store).
export const Currency = sequelize.define(
  "Currency",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    code: { type: DataTypes.STRING(3), allowNull: false, defaultValue: CURRENCY_DEFAULTS.code },
    name: { type: DataTypes.STRING(64), allowNull: false, defaultValue: CURRENCY_DEFAULTS.name },
    symbol: { type: DataTypes.STRING(8), allowNull: false, defaultValue: CURRENCY_DEFAULTS.symbol },
    decimal_places: {
      type: DataTypes.TINYINT,
      allowNull: false,
      defaultValue: CURRENCY_DEFAULTS.decimal_places,
    },
    symbol_position: {
      type: DataTypes.ENUM("before", "after"),
      allowNull: false,
      defaultValue: CURRENCY_DEFAULTS.symbol_position,
    },
  },
  {
    ...modelOptions,
    tableName: "currencies",
    indexes: [{ unique: true, fields: ["store_id"] }],
  }
)
