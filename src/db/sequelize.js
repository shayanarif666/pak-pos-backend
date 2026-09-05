import { Sequelize } from "sequelize"
import { databaseConfig } from "../config/database.js"

export const sequelize = new Sequelize(databaseConfig)
