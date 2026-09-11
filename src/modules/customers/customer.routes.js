import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import {
  parseCreateCustomer,
  parseCreditEntry,
  parsePatchCustomer,
} from "./customer.validation.js"
import {
  addCredit,
  create,
  createBulk,
  getOne,
  list,
  listCredit,
  patch,
} from "./customer.controller.js"

const router = Router()

router.use(
  authMiddleware,
  authorize("store_admin", "manager", "cashier"),
  tenantMiddleware,
  requireTenantStore
)

router.get("/", list)
router.post("/", validate(parseCreateCustomer), create)
router.post("/bulk", createBulk)
router.get("/:id/credit", listCredit)
router.post("/:id/credit", validate(parseCreditEntry), addCredit)
router.get("/:id", getOne)
router.patch("/:id", validate(parsePatchCustomer), patch)

export default router
