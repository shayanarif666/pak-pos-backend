import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { REVIEW_STATUS } from "../../db/enums.js"

export const Review = sequelize.define(
  "Review",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    product_id: uuidCol(false),
    user_id: uuidCol(true),
    rating: { type: DataTypes.INTEGER, allowNull: false },
    comment: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.ENUM(...REVIEW_STATUS),
      allowNull: false,
      defaultValue: "pending",
    },
    reviewed_by: uuidCol(true),
    reviewed_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    ...modelOptions,
    tableName: "reviews",
    indexes: [{ unique: true, fields: ["user_id", "product_id"] }],
  }
)
