import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"

/** A location an offer runs at (used when offers.location_scope is "selected"). */
export const OfferLocation = sequelize.define(
  "OfferLocation",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    offer_id: uuidCol(false),
    location_id: uuidCol(false),
  },
  {
    ...modelOptions,
    tableName: "offer_locations",
    indexes: [{ unique: true, fields: ["offer_id", "location_id"] }],
  }
)
