import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import { requireTenantStore, tenantMiddleware } from "../../shared/middlewares/tenant.middleware.js"
import { requestScope } from "../../shared/middlewares/requestScope.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import { parseCreateOffer, parsePatchOffer, parseReplaceTargets } from "../offers/offer.validation.js"
import {
  create,
  createBulk,
  getOne,
  list,
  listTargets,
  patch,
  patchBulk,
  patchBulkStatus,
  putTargets,
  remove,
} from "../offers/offer.controller.js"

/*
 * Bulk discount = buy X, get Y free (BOGO): products and / or categories, buy_qty + get_qty, in
 * units or packs, optional free product, dates, locations. It runs on the offers engine with the
 * type fixed to "bogo", so the type is never sent here and a bulk discount cannot become another type.
 */
const BULK_TYPE = "bogo"

const withType = (item) => (item && typeof item === "object" && !Array.isArray(item) ? { ...item, type: BULK_TYPE } : item)
const withoutType = (item) => {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item
  const { type: _type, ...rest } = item
  return rest
}
const itemsOf = (body, map) => (Array.isArray(body) ? body.map(map) : body && Array.isArray(body.items) ? { ...body, items: body.items.map(map) } : body)

const forceOnCreate = (req, _res, next) => {
  req.body = withType(req.body)
  next()
}
const forceOnCreateBulk = (req, _res, next) => {
  req.body = itemsOf(req.body, withType)
  next()
}
const dropTypeOnPatch = (req, _res, next) => {
  req.body = withoutType(req.body)
  next()
}
const dropTypeOnPatchBulk = (req, _res, next) => {
  req.body = itemsOf(req.body, withoutType)
  next()
}
const listBulkOnly = (req, _res, next) => {
  req.query = { ...req.query, type: BULK_TYPE }
  next()
}

const router = Router()
const tenant = [authMiddleware, tenantMiddleware, requireTenantStore]
const read = [...tenant, authorize("store_admin", "manager", "cashier")]
const write = [...tenant, authorize("store_admin", "manager")]
const detail = [...tenant, authorize("store_admin", "manager")]
const add = [...tenant, authorize("store_admin", "manager", "cashier")]

router.get("/", ...read, listBulkOnly, list)
router.post("/", ...add, requestScope({ location: false }), forceOnCreate, validate(parseCreateOffer), create)
router.post("/bulk", ...add, requestScope({ location: false }), forceOnCreateBulk, createBulk)
router.patch("/bulk", ...write, dropTypeOnPatchBulk, patchBulk)
router.patch("/bulk/status", ...write, patchBulkStatus)
router.get("/:id/targets", ...read, listTargets)
router.put("/:id/targets", ...write, validate(parseReplaceTargets), putTargets)
router.get("/:id", ...detail, getOne)
router.patch("/:id", ...write, dropTypeOnPatch, validate(parsePatchOffer), patch)
router.delete("/:id", ...write, remove)

export default router
