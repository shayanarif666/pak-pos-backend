import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { PAYMENT_METHOD } from "../../db/enums.js"

export const PaymentMethodTaxRate = sequelize.define(
  "PaymentMethodTaxRate",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    payment_method: { type: DataTypes.ENUM(...PAYMENT_METHOD), allowNull: false },
    gst_percent: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
  },
  {
    ...modelOptions,
    tableName: "payment_method_tax_rates",
    indexes: [{ unique: true, fields: ["store_id", "payment_method"] }],
  }
)
