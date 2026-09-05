import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { DISCOUNT_TYPE, OFFER_APPLY_TO, OFFER_TYPE } from "../../db/enums.js"

export const Offer = sequelize.define(
  "Offer",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    location_id: uuidCol(true),
    name: { type: DataTypes.TEXT, allowNull: false },
    type: { type: DataTypes.ENUM(...OFFER_TYPE), allowNull: false },
    apply_to: { type: DataTypes.ENUM(...OFFER_APPLY_TO), allowNull: false },
    discount_type: { type: DataTypes.ENUM(...DISCOUNT_TYPE), allowNull: true },
    discount_value: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    min_qty: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
    buy_qty: { type: DataTypes.INTEGER, allowNull: true },
    get_qty: { type: DataTypes.INTEGER, allowNull: true },
    start_at: { type: DataTypes.DATE, allowNull: true },
    end_at: { type: DataTypes.DATE, allowNull: true },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_by: uuidCol(true),
  },
  { ...modelOptions, tableName: "offers" }
)
