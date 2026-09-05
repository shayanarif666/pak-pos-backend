import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"

export const StoreTheme = sequelize.define(
  "StoreTheme",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    primary: { type: DataTypes.TEXT, allowNull: false, field: "primary" },
    secondary: { type: DataTypes.TEXT, allowNull: false },
    accent: { type: DataTypes.TEXT, allowNull: false },
    btn_filled_bg: { type: DataTypes.TEXT, allowNull: true },
    btn_filled_text: { type: DataTypes.TEXT, allowNull: true },
    btn_filled_hover: { type: DataTypes.TEXT, allowNull: true },
    btn_outline_border: { type: DataTypes.TEXT, allowNull: true },
    btn_outline_text: { type: DataTypes.TEXT, allowNull: true },
    btn_outline_hover: { type: DataTypes.TEXT, allowNull: true },
    btn_text_color: { type: DataTypes.TEXT, allowNull: true },
    btn_text_hover: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    ...modelOptions,
    tableName: "store_themes",
    indexes: [{ unique: true, fields: ["store_id"] }],
  }
)
