import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"

/** A branch a supplier delivers to (used when suppliers.location_scope is "selected"). */
export const SupplierLocation = sequelize.define(
  "SupplierLocation",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    supplier_id: uuidCol(false),
    location_id: uuidCol(false),
  },
  { ...modelOptions, tableName: "supplier_locations" }
)
