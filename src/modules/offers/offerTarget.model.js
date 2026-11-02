import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { noTimestamps, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { OFFER_SALE_UNIT } from "../../db/enums.js"

export const OfferTarget = sequelize.define(
  "OfferTarget",
  {
    id: uuidPk(),
    offer_id: uuidCol(false),
    product_id: uuidCol(true),
    category_id: uuidCol(true),
    free_product_id: uuidCol(true),
    promo_price: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    // This product's own unit / pack / both (null = the offer's sale_unit).
    sale_unit: { type: DataTypes.ENUM(...OFFER_SALE_UNIT), allowNull: true },
    // Flash sale: the whole pack's price (promo_price is one unit's).
    promo_pack_price: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
  },
  { ...noTimestamps, tableName: "offer_targets" }
)
