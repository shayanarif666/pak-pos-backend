import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"

/** A branch a supplier delivers to (used when suppliers.location_scope is "selected"). */
export const SupplierLocation = sequelize.define(
  "SupplierLocation",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    // Per-supplier sequence (1,2,3...) over this supplier's current set of serviced locations.
    supplier_location_number: { type: DataTypes.INTEGER, allowNull: false },
    supplier_id: uuidCol(false),
    location_id: uuidCol(false),
  },
  {
    ...modelOptions,
    tableName: "supplier_locations",
    indexes: [{ unique: true, fields: ["supplier_id", "supplier_location_number"] }],
  }
)
