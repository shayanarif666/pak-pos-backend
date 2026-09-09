import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"
import {
  DISCOUNT_TYPE,
  ORDER_CHANNEL,
  ORDER_PAYMENT_STATUS,
  ORDER_STATUS,
  PAYMENT_METHOD,
} from "../../db/enums.js"

export const Order = sequelize.define(
  "Order",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    location_id: uuidCol(true),
    location_id_int: { type: DataTypes.INTEGER, allowNull: true },
    channel: { type: DataTypes.ENUM(...ORDER_CHANNEL), allowNull: false },
    is_custom: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    order_number: { type: DataTypes.INTEGER, allowNull: false },
    cashier_id: uuidCol(true),
    customer_id: uuidCol(true),
    register_session_id: uuidCol(true),
    client_local_id: { type: DataTypes.STRING(255), allowNull: true },
    gross_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    line_discount_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    subtotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    is_order_discounted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    order_discount_type: { type: DataTypes.ENUM(...DISCOUNT_TYPE), allowNull: true },
    discount_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    coupon_id: uuidCol(true),
    coupon_code: { type: DataTypes.STRING(64), allowNull: true },
    coupon_discount_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    tax_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    shipping_fee: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    total_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    cost_total: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    payment_method: { type: DataTypes.ENUM(...PAYMENT_METHOD), allowNull: false },
    payment_status: {
      type: DataTypes.ENUM(...ORDER_PAYMENT_STATUS),
      allowNull: false,
      defaultValue: "pending",
    },
    shipping_address: { type: DataTypes.TEXT, allowNull: true },
    order_status: {
      type: DataTypes.ENUM(...ORDER_STATUS),
      allowNull: false,
      defaultValue: "pending",
    },
    amount_paid: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    change_due: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    void_reason: { type: DataTypes.TEXT, allowNull: true },
    voided_by: uuidCol(true),
    cancel_reason: { type: DataTypes.TEXT, allowNull: true },
    cancelled_by: uuidCol(true),
    placed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    synced_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    ...modelOptions,
    tableName: "orders",
    indexes: [
      { unique: true, fields: ["store_id", "order_number"] },
      { unique: true, fields: ["store_id", "client_local_id"] },
      { fields: ["store_id", "placed_at"] },
      { fields: ["store_id", "location_id", "channel", "order_status"] },
    ],
  }
)
