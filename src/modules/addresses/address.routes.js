import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import { parseCreateAddress, parsePatchAddress } from "./address.validation.js"
import { create, list, patch, remove } from "./address.controller.js"

const router = Router()
const customer = [
  authMiddleware,
  tenantMiddleware,
  requireTenantStore,
  authorize("customer"),
]

router.get("/", ...customer, list)
router.post("/", ...customer, validate(parseCreateAddress), create)
router.patch("/:id", ...customer, validate(parsePatchAddress), patch)
router.delete("/:id", ...customer, remove)

export default router
