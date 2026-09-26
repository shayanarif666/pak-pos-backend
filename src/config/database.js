import { env } from "./env.js"

export const databaseConfig = {
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  username: env.DB_USER,
  password: env.DB_PASSWORD,
  dialect: "mysql",
  // Keep DATETIME comparisons in UTC; report ranges use store timezone explicitly.
  timezone: "+00:00",
  logging: env.NODE_ENV === "development" ? false : false,
  define: {
    underscored: false,
    freezeTableName: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
}
