import dotenv from "dotenv"

dotenv.config()

function required(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number(process.env.PORT) || 5000,
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  DB_HOST: process.env.DB_HOST || "127.0.0.1",
  DB_PORT: Number(process.env.DB_PORT) || 3306,
  DB_NAME: process.env.DB_NAME || "pak_pos",
  DB_USER: process.env.DB_USER || "root",
  DB_PASSWORD: process.env.DB_PASSWORD ?? "",
  // Hosted MySQL (Aiven, TiDB Cloud…) needs TLS: DB_SSL=true.
  DB_SSL: process.env.DB_SSL === "true",
  // The provider's CA certificate (PEM text; Aiven: Overview → CA certificate). A literal "\n"
  // in the value is read as a line break.
  DB_SSL_CA: (process.env.DB_SSL_CA || "").replace(/\\n/g, "\n"),
  JWT_SECRET: required("JWT_SECRET"),
  DB_POOL_MAX: Number(process.env.DB_POOL_MAX) || 20,
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || "1d",
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  SUPERADMIN_EMAIL: process.env.SUPERADMIN_EMAIL || "superadmin@platform.local",
  SUPERADMIN_PASSWORD: process.env.SUPERADMIN_PASSWORD || "ChangeMeSuperAdmin1",
  SUPERADMIN_NAME: process.env.SUPERADMIN_NAME || "Platform Super Admin",
  SUPERADMIN_PIN: process.env.SUPERADMIN_PIN || "",
  CLOUDINARY_CLOUD_NAME:
    process.env.CLOUDINARY_CLOUD_NAME || process.env.Cloudinary_CLOUD_NAME || "",
  CLOUDINARY_API_KEY:
    process.env.CLOUDINARY_API_KEY || process.env.Cloudinary_API_KEY || "",
  CLOUDINARY_API_SECRET:
    process.env.CLOUDINARY_API_SECRET || process.env.Cloudinary_API_SECRET || "",
  SMTP_HOST: process.env.SMTP_HOST || "",
  SMTP_PORT: Number(process.env.SMTP_PORT) || 587,
  SMTP_SECURE: process.env.SMTP_SECURE === "true",
  SMTP_USER: process.env.SMTP_USER || "",
  SMTP_PASS: process.env.SMTP_PASS || "",
  SMTP_FROM: process.env.SMTP_FROM || process.env.SMTP_USER || "",
  // Resend (HTTPS API, preferred when set): the API key and the sender, e.g. "POS <no-reply@domain.com>".
  RESEND_API_KEY: process.env.RESEND_API_KEY || "",
  MAIL_FROM: process.env.MAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || "",
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:3000",
  // Render free plan: the service's own health URL, pinged every 10 min so it never sleeps.
  KEEP_ALIVE_URL: process.env.KEEP_ALIVE_URL || "",
}

export const isProduction = env.NODE_ENV === "production"
