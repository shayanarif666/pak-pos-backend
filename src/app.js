import express from "express"
import cors from "cors"
import helmet from "helmet"
import compression from "compression"
import morgan from "morgan"
import apiRoutes from "./routes/index.js"
import { notFoundMiddleware } from "./shared/middlewares/notFound.middleware.js"
import { errorMiddleware } from "./shared/middlewares/error.middleware.js"
import { env } from "./config/env.js"

export function createApp() {
  const app = express()

  app.use(helmet())
  app.use(cors())
  app.use(compression())
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))

  if (env.NODE_ENV !== "production") {
    app.use(morgan("dev"))
  }

  app.use("/api", apiRoutes)
  app.use(notFoundMiddleware)
  app.use(errorMiddleware)

  return app
}
