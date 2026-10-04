import { env } from "./config/env.js"
import { logger } from "./config/logger.js"
import { sequelize } from "./db/sequelize.js"
import { registerModels } from "./db/registerModels.js"
import { ensureSchema } from "./db/ensureSchema.js"
import { createApp } from "./app.js"
import { expireOverdueLicenses } from "./modules/stores/license.service.js"

const LICENSE_SWEEP_MS = 60 * 60 * 1000

// Licenses whose paid period has ended become "expired" without anyone opening them.
function scheduleLicenseExpiry() {
  const run = () =>
    expireOverdueLicenses()
      .then((count) => {
        if (count) logger.info(`Expired ${count} license(s)`)
      })
      .catch((err) => logger.error(`License expiry sweep failed: ${err.message}`))
  run()
  setInterval(run, LICENSE_SWEEP_MS).unref()
}

async function start() {
  registerModels()
  await sequelize.authenticate()
  logger.info("MySQL connected")
  await ensureSchema()
  scheduleLicenseExpiry()

  const app = createApp()
  app.listen(env.PORT, () => {
    logger.info(`API listening on port ${env.PORT}`)
  })
}

start().catch((err) => {
  logger.error(err.message, { stack: err.stack })
  process.exit(1)
})
