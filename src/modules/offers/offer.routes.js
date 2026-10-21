import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import {
  parseCreateOffer,
  parsePatchOffer,
  parseReplaceTargets,
} from "./offer.validation.js"
import {
  create,
  createBulk,
  getOne,
  list,
  listTargets,
  patch,
  putTargets,
  remove,
} from "./offer.controller.js"

const router = Router()
const tenant = [authMiddleware, tenantMiddleware, requireTenantStore]
const read = [...tenant, authorize("store_admin", "manager", "cashier")]
const write = [...tenant, authorize("store_admin", "manager")]
const detail = [...tenant, authorize("store_admin", "manager")]
// Cashiers add offers too, always for their own location (see offer.service.js).
const add = [...tenant, authorize("store_admin", "manager", "cashier")]

router.get("/", ...read, list)
router.post("/", ...add, validate(parseCreateOffer), create)
router.post("/bulk", ...add, createBulk)
router.get("/:id/targets", ...read, listTargets)
router.put(
  "/:id/targets",
  ...write,
  validate(parseReplaceTargets),
  putTargets
)
router.get("/:id", ...detail, getOne)
router.patch("/:id", ...write, validate(parsePatchOffer), patch)
router.delete("/:id", ...write, remove)

export default router
