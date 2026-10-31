import { env } from "./env.js"

export const databaseConfig = {
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  username: env.DB_USER,
  password: env.DB_PASSWORD,
  dialect: "mysql",
  // TLS for hosted MySQL; the server certificate is checked against DB_SSL_CA when given.
  ...(env.DB_SSL
    ? { dialectOptions: { ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true, ...(env.DB_SSL_CA ? { ca: env.DB_SSL_CA } : {}) } } }
    : {}),
  // Keep DATETIME comparisons in UTC; report ranges use store timezone explicitly.
  timezone: "+00:00",
  logging: env.NODE_ENV === "development" ? false : false,
  pool: {
    max: env.DB_POOL_MAX,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
  define: {
    underscored: false,
    freezeTableName: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
}
