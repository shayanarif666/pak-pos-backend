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
  JWT_SECRET: required("JWT_SECRET"),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "10y",
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
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:3000",
}

export const isProduction = env.NODE_ENV === "production"
