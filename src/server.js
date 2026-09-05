import { env } from "./config/env.js"
import { logger } from "./config/logger.js"
import { sequelize } from "./db/sequelize.js"
import { registerModels } from "./db/registerModels.js"
import { createApp } from "./app.js"

async function start() {
  registerModels()
  await sequelize.authenticate()
  logger.info("MySQL connected")

  const app = createApp()
  app.listen(env.PORT, () => {
    logger.info(`API listening on port ${env.PORT}`)
  })
}

start().catch((err) => {
  logger.error(err.message, { stack: err.stack })
  process.exit(1)
})
