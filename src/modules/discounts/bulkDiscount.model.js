import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, noTimestamps, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { DISCOUNT_TYPE } from "../../db/enums.js"

/**
 * A bulk discount: buy more of ONE product (or one variant: its own product row) and every unit
 * gets cheaper, in steps (tiers). sale_unit says what min_qty counts: single units or whole packs.
 */
export const BulkDiscount = sequelize.define(
  "BulkDiscount",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    bulk_number: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.TEXT, allowNull: false },
    product_id: uuidCol(false),
    sale_unit: { type: DataTypes.ENUM("unit", "pack"), allowNull: false, defaultValue: "unit" },
    start_at: { type: DataTypes.DATE, allowNull: true },
    end_at: { type: DataTypes.DATE, allowNull: true },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_by: uuidCol(true),
    deleted_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    ...modelOptions,
    tableName: "bulk_discounts",
    paranoid: true,
    deletedAt: "deleted_at",
    indexes: [{ unique: true, fields: ["store_id", "bulk_number"] }],
  }
)

/** One step: from min_qty on, each unit is cut by discount_value (percentage of its price, or Rs off each unit). */
export const BulkDiscountTier = sequelize.define(
  "BulkDiscountTier",
  {
    id: uuidPk(),
    bulk_id: uuidCol(false),
    min_qty: { type: DataTypes.DECIMAL(12, 4), allowNull: false },
    discount_type: { type: DataTypes.ENUM(...DISCOUNT_TYPE), allowNull: false },
    discount_value: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  },
  { ...noTimestamps, tableName: "bulk_discount_tiers", indexes: [{ unique: true, fields: ["bulk_id", "min_qty"] }] }
)
