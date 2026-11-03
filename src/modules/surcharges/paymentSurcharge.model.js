import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { PAYMENT_METHOD, TAX_AMOUNT_TYPE } from "../../db/enums.js"

/** The methods a surcharge can be set for: every payment method (a mixed payment uses each part's own). */
export const SURCHARGE_METHODS = PAYMENT_METHOD.filter((method) => method !== "mixed")

/**
 * What paying by a method adds to the bill: a percentage of that payment's share, or a fixed amount
 * per payment. One per method per store.
 */
export const PaymentSurcharge = sequelize.define(
  "PaymentSurcharge",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    surcharge_number: { type: DataTypes.INTEGER, allowNull: false },
    method: { type: DataTypes.ENUM(...SURCHARGE_METHODS), allowNull: false },
    type: { type: DataTypes.ENUM(...TAX_AMOUNT_TYPE), allowNull: false, defaultValue: "percentage" },
    charges: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_by: uuidCol(true),
  },
  {
    ...modelOptions,
    tableName: "payment_method_surcharges",
    indexes: [
      { unique: true, fields: ["store_id", "surcharge_number"] },
      { unique: true, fields: ["store_id", "method"] },
    ],
  }
)
