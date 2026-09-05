import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { noTimestamps, uuidCol, uuidPk } from "../../db/columnTypes.js"

export const OfferTarget = sequelize.define(
  "OfferTarget",
  {
    id: uuidPk(),
    offer_id: uuidCol(false),
    product_id: uuidCol(true),
    category_id: uuidCol(true),
    free_product_id: uuidCol(true),
    promo_price: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
  },
  { ...noTimestamps, tableName: "offer_targets" }
)
