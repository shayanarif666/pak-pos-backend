import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { TAX_AMOUNT_TYPE } from "../../db/enums.js"

export const Category = sequelize.define(
  "Category",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.TEXT, allowNull: false },
    slug: { type: DataTypes.STRING(255), allowNull: false },
    parent_category_id: uuidCol(true),
    image_url: { type: DataTypes.TEXT, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    tax_type: { type: DataTypes.ENUM(...TAX_AMOUNT_TYPE), allowNull: true },
    tax_value: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    pos_visible: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    web_visible: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  {
    ...modelOptions,
    tableName: "categories",
    indexes: [{ unique: true, fields: ["store_id", "slug"] }],
  }
)
