import { env } from "./config/env.js"
import { logger } from "./config/logger.js"
import { sequelize } from "./db/sequelize.js"
import { registerModels } from "./db/registerModels.js"
import { ensureSchema } from "./db/ensureSchema.js"
import { createApp } from "./app.js"
import { expireOverdueLicenses } from "./modules/stores/license.service.js"
import { deleteExpiredTrialStores } from "./modules/admin/adminData.service.js"

// TESTING ONLY: 1 minute instead of 1 hour, to verify the sweep fires on Railway. Revert to
// 60 * 60 * 1000 before going back to normal.
const LICENSE_SWEEP_MS = 60 * 1000

// Licenses whose paid period has ended become "expired" without anyone opening them.
function scheduleLicenseExpiry() {
  const run = () =>
    expireOverdueLicenses()
      .then((count) => {
        // TESTING ONLY: always print, not just when count > 0, so the sweep is visible in logs.
        console.log(`[license-sweep] ran at ${new Date().toISOString()}, expired ${count} license(s)`)
        if (count) logger.info(`Expired ${count} license(s)`)
      })
      .catch((err) => logger.error(`License expiry sweep failed: ${err.message}`))
      // A trial store that did not buy a plan within the decision days is deleted with its data.
      .then(() => deleteExpiredTrialStores())
      .then((count) => count && logger.info(`Deleted ${count} expired trial store(s)`))
      .catch((err) => logger.error(`Trial store cleanup failed: ${err.message}`))
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
    scheduleKeepAlive()
  })
}

// Render's free plan puts the service to sleep after 15 min without a request. A request to our
// own public health URL every 10 min keeps it (and, through the health check's SELECT 1, the
// free database) awake. Off unless KEEP_ALIVE_URL is set (not needed locally or on a paid plan).
const KEEP_ALIVE_MS = 10 * 60 * 1000

function scheduleKeepAlive() {
  if (!env.KEEP_ALIVE_URL) return
  setInterval(() => {
    fetch(env.KEEP_ALIVE_URL, { signal: AbortSignal.timeout(30000) })
      .then((res) => {
        if (!res.ok) logger.warn(`Keep-alive ping got ${res.status}`)
      })
      .catch((err) => logger.warn(`Keep-alive ping failed: ${err.message}`))
  }, KEEP_ALIVE_MS).unref()
  logger.info(`Keep-alive ping every 10 min: ${env.KEEP_ALIVE_URL}`)
}

start().catch((err) => {
  logger.error(err.message, { stack: err.stack })
  process.exit(1)
})
