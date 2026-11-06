import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import {
  DISCOUNT_TYPE,
  OFFER_APPLY_TO,
  OFFER_SALE_UNIT,
  OFFER_TYPE,
  SALE_UNIT,
  SUPPLIER_LOCATION_SCOPE,
} from "../../db/enums.js"

export const Offer = sequelize.define(
  "Offer",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    offer_number: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.TEXT, allowNull: false },
    type: { type: DataTypes.ENUM(...OFFER_TYPE), allowNull: false },
    apply_to: { type: DataTypes.ENUM(...OFFER_APPLY_TO), allowNull: false },
    // On a pack product: single items (unit), the whole pack, or both. A target may override it.
    sale_unit: { type: DataTypes.ENUM(...OFFER_SALE_UNIT), allowNull: false, defaultValue: "both" },
    // "all" = every location; "selected" = only the locations in offer_locations.
    location_scope: {
      type: DataTypes.ENUM(...SUPPLIER_LOCATION_SCOPE),
      allowNull: false,
      defaultValue: "all",
    },
    discount_type: { type: DataTypes.ENUM(...DISCOUNT_TYPE), allowNull: true },
    discount_value: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    min_qty: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
    // Bulk discount: min_qty counted in units or packs.
    min_qty_unit: { type: DataTypes.ENUM(...SALE_UNIT), allowNull: false, defaultValue: "unit" },
    buy_qty: { type: DataTypes.INTEGER, allowNull: true },
    // BOGO: what is bought and what is given free, in units or packs (e.g. buy 1 pack, get 1 unit).
    buy_unit: { type: DataTypes.ENUM(...SALE_UNIT), allowNull: false, defaultValue: "unit" },
    get_qty: { type: DataTypes.INTEGER, allowNull: true },
    get_unit: { type: DataTypes.ENUM(...SALE_UNIT), allowNull: false, defaultValue: "unit" },
    start_at: { type: DataTypes.DATE, allowNull: true },
    end_at: { type: DataTypes.DATE, allowNull: true },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_by: uuidCol(true),
    deleted_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    ...modelOptions,
    tableName: "offers",
    // Soft delete: destroy() sets deleted_at; lists, the POS and pricing leave it out. Sales made
    // with it read it with paranoid: false.
    paranoid: true,
    deletedAt: "deleted_at",
    indexes: [{ unique: true, fields: ["store_id", "offer_number"] }],
  }
)
