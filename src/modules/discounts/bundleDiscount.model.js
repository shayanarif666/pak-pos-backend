import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { DISCOUNT_TYPE } from "../../db/enums.js"

export const BUNDLE_REWARD = ["free_item", "percentage", "fixed"]

/**
 * Buy several products together (the components, each with its qty) and get a reward: free items
 * (reward_type free_item, the items are in bundle_discount_rewards), or a percentage / fixed amount off.
 */
export const BundleDiscount = sequelize.define(
  "BundleDiscount",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    bundle_number: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.TEXT, allowNull: false },
    reward_type: { type: DataTypes.ENUM(...BUNDLE_REWARD), allowNull: false, defaultValue: "percentage" },
    // reward_type percentage / fixed only.
    discount_type: { type: DataTypes.ENUM(...DISCOUNT_TYPE), allowNull: true },
    discount_value: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    start_at: { type: DataTypes.DATE, allowNull: true },
    end_at: { type: DataTypes.DATE, allowNull: true },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_by: uuidCol(true),
    deleted_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    ...modelOptions,
    tableName: "bundle_discounts",
    paranoid: true,
    deletedAt: "deleted_at",
    indexes: [{ unique: true, fields: ["store_id", "bundle_number"] }],
  }
)
