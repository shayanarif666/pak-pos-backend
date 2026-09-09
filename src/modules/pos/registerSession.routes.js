import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import { parseClockIn, parseClockOut } from "./registerSession.validation.js"
import {
  clockIn,
  clockOut,
  current,
  getOne,
  list,
} from "./registerSession.controller.js"

const router = Router()
const tenant = [authMiddleware, tenantMiddleware, requireTenantStore]
const staff = [...tenant, authorize("store_admin", "manager", "cashier")]
const till = [...tenant, authorize("store_admin", "manager", "cashier")]

router.get("/", ...staff, list)
router.get("/current", ...till, current)
router.post("/", ...till, validate(parseClockIn), clockIn)
router.post("/:id/clock-out", ...till, validate(parseClockOut), clockOut)
router.get("/:id", ...staff, getOne)

export default router
