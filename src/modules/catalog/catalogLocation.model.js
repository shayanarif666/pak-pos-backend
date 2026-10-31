import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"

/** A location a category is sold at (used when categories.location_scope is "selected"). */
export const CategoryLocation = sequelize.define(
  "CategoryLocation",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    category_id: uuidCol(false),
    location_id: uuidCol(false),
  },
  {
    ...modelOptions,
    tableName: "category_locations",
    indexes: [{ unique: true, fields: ["category_id", "location_id"] }],
  }
)

/** A location a product is sold at (used when products.location_scope is "selected"). */
export const ProductLocation = sequelize.define(
  "ProductLocation",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    product_id: uuidCol(false),
    location_id: uuidCol(false),
  },
  {
    ...modelOptions,
    tableName: "product_locations",
    indexes: [{ unique: true, fields: ["product_id", "location_id"] }],
  }
)
