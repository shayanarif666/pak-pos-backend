import { DataTypes } from "sequelize"

export function uuidPk() {
  return {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
    allowNull: false,
  }
}

export function uuidCol(allowNull = false) {
  return { type: DataTypes.UUID, allowNull }
}

export const modelOptions = {
  timestamps: true,
  createdAt: "created_at",
  updatedAt: "updated_at",
  underscored: false,
  freezeTableName: true,
}

export const createdOnly = {
  timestamps: true,
  createdAt: "created_at",
  updatedAt: false,
  underscored: false,
  freezeTableName: true,
}

export const noTimestamps = {
  timestamps: false,
  underscored: false,
  freezeTableName: true,
}
