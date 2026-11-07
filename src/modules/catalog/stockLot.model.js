import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"

/**
 * A lot: part of a product's (or variant's) stock at a location that came in together, with its
 * own expiry date. product_stocks.qty is the total of the lots. lot_number is the product's (1, 2, 3… per product or variant).
 */
export const StockLot = sequelize.define(
  "StockLot",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    lot_number: { type: DataTypes.INTEGER, allowNull: false },
    location_id: uuidCol(false),
    location_id_int: { type: DataTypes.INTEGER, allowNull: true },
    product_id: uuidCol(false),
    qty: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
    expiry_date: { type: DataTypes.DATEONLY, allowNull: true },
    // When it came in (FEFO breaks ties by it).
    received_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    // opening | purchase | stock_in | transfer | refund | adjustment
    source: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "stock_in" },
    // Soft delete from Product Stock & Expiry (its qty is 0 by then).
    deleted_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    ...modelOptions,
    tableName: "stock_lots",
    indexes: [
      { unique: true, fields: ["store_id", "product_id", "lot_number"] },
      { fields: ["location_id", "product_id"] },
    ],
  }
)
