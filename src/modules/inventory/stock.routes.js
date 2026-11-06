import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { requestScope } from "../../shared/middlewares/requestScope.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import { parseCreateMovement } from "./stock.validation.js"
import { create, createBulk, list, patchBulk, remove } from "./stock.controller.js"

const router = Router()

router.use(
  authMiddleware,
  authorize("store_admin", "manager"),
  tenantMiddleware,
  requireTenantStore
)

router.get("/", list)
router.post("/", requestScope(), validate(parseCreateMovement), create)
router.post("/bulk", requestScope(), createBulk)
// Fix wrong movements: { items: [{ id (movement number), ... }] }; the stock follows.
router.patch("/bulk", patchBulk)
// Soft delete a wrong movement (:id = movement number); its qty is taken back off the stock.
router.delete("/:id", remove)

export default router
