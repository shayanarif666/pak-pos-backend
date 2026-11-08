import { sequelize } from "../../db/sequelize.js"
import { noTimestamps, uuidCol, uuidPk } from "../../db/columnTypes.js"

/** The products (cartons / packs) a bundle discount applies to. */
export const BundleDiscountProduct = sequelize.define(
  "BundleDiscountProduct",
  {
    id: uuidPk(),
    bundle_id: uuidCol(false),
    product_id: uuidCol(false),
  },
  { ...noTimestamps, tableName: "bundle_discount_products" }
)
