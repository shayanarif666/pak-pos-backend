import cls from "cls-hooked"
import { Sequelize } from "sequelize"
import { databaseConfig } from "../config/database.js"

// Queries inside sequelize.transaction(cb) reuse that transaction automatically.
// Without this, helpers that forget `{ transaction }` take a second pool
// connection and concurrent checkouts deadlock the pool.
Sequelize.useCLS(cls.createNamespace("sequelize-tx"))

export const sequelize = new Sequelize(databaseConfig)
