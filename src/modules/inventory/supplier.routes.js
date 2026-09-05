import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import {
  parseCreateSupplier,
  parseLedgerEntry,
  parsePatchSupplier,
} from "./supplier.validation.js"
import {
  addLedger,
  create,
  getOne,
  list,
  listLedger,
  patch,
  remove,
} from "./supplier.controller.js"

const router = Router()

router.use(
  authMiddleware,
  authorize("store_admin", "manager"),
  tenantMiddleware,
  requireTenantStore
)

router.get("/", list)
router.post("/", validate(parseCreateSupplier), create)
router.get("/:id/ledger", listLedger)
router.post("/:id/ledger", validate(parseLedgerEntry), addLedger)
router.get("/:id", getOne)
router.patch("/:id", validate(parsePatchSupplier), patch)
router.delete("/:id", remove)

export default router
