import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { createdOnly, uuidCol, uuidPk } from "../../db/columnTypes.js"
import { AUDIT_ACTION, AUDIT_ACTOR_TYPE } from "../../db/enums.js"

export const AuditLog = sequelize.define(
  "AuditLog",
  {
    id: uuidPk(),
    store_id: uuidCol(true),
    store_id_int: { type: DataTypes.INTEGER, allowNull: true },
    location_id: uuidCol(true),
    location_id_int: { type: DataTypes.INTEGER, allowNull: true },
    device_id: uuidCol(true),
    actor_type: { type: DataTypes.ENUM(...AUDIT_ACTOR_TYPE), allowNull: false },
    user_id: uuidCol(true),
    action: { type: DataTypes.ENUM(...AUDIT_ACTION), allowNull: false },
    entity_type: { type: DataTypes.TEXT, allowNull: false },
    entity_id: uuidCol(true),
    before_data: { type: DataTypes.JSON, allowNull: true },
    after_data: { type: DataTypes.JSON, allowNull: true },
    channel: { type: DataTypes.STRING(32), allowNull: true },
    ip_address: { type: DataTypes.STRING(64), allowNull: true },
    user_agent: { type: DataTypes.TEXT, allowNull: true },
    note: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    ...createdOnly,
    tableName: "audit_logs",
    indexes: [
      { fields: ["store_id", "created_at"] },
      { fields: ["store_id", "entity_type", "entity_id"] },
    ],
  }
)
