import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import { tenantMiddleware } from "../../shared/middlewares/tenant.middleware.js"
import { uploadSingleImage } from "../../shared/middlewares/upload.middleware.js"
import { create } from "./upload.controller.js"

const router = Router()

router.post(
  "/",
  authMiddleware,
  tenantMiddleware,
  authorize("superadmin", "store_admin", "manager"),
  uploadSingleImage("file"),
  create
)

export default router
