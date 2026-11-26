import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { CASH_MOVEMENT_PARTY, CASH_MOVEMENT_TYPE } from "../../db/enums.js"

/** Pay In / Pay Out: cash put into or taken out of a till's drawer by hand (see the migration). */
export const CashMovement = sequelize.define(
  "CashMovement",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    movement_number: { type: DataTypes.INTEGER, allowNull: false },
    location_id: uuidCol(false),
    location_id_int: { type: DataTypes.INTEGER, allowNull: false },
    batch_id: uuidCol(true),
    device_id: uuidCol(true),
    staff_id: uuidCol(true),
    type: { type: DataTypes.ENUM(...CASH_MOVEMENT_TYPE), allowNull: false },
    reason: { type: DataTypes.TEXT, allowNull: false },
    amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    party_type: { type: DataTypes.ENUM(...CASH_MOVEMENT_PARTY), allowNull: true },
    party_id: uuidCol(true),
    party_name: { type: DataTypes.STRING(255), allowNull: true },
    from_user: uuidCol(true),
    to_user: uuidCol(true),
    occurred_at: { type: DataTypes.DATE, allowNull: false },
    attachment_url: { type: DataTypes.STRING(1024), allowNull: true },
    client_local_id: { type: DataTypes.STRING(128), allowNull: true },
    deleted_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    ...modelOptions,
    tableName: "cash_movements",
    indexes: [
      { unique: true, fields: ["store_id", "movement_number"] },
      { unique: true, fields: ["store_id", "client_local_id"] },
    ],
  }
)
