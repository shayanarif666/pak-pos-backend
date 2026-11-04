import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import { requestScope } from "../../shared/middlewares/requestScope.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { clockIn, clockOut, patchBulk, patchOne, list, remove } from "./staffSession.controller.js"

const router = Router()

// Only a store admin or manager holds a token; they clock in themselves or the cashier picked by PIN.
router.use(authMiddleware, authorize("store_admin", "manager"), tenantMiddleware, requireTenantStore)

router.get("/", list)
// Each item is one staff member (id / staff_id); a staff_id sent once on top fills the rest.
const clockScope = requestScope({ staffKeys: ["staff_id", "staffId", "id"] })
router.post("/clock-in", clockScope, clockIn)
router.post("/clock-out", clockScope, clockOut)
// A manager corrects attendance: items[] = [{ id (session number), clock_in_at?, clock_out_at? }].
router.patch("/bulk", patchBulk)
// One session (session number or UUID): edit its times, or soft delete it.
router.patch("/:id", patchOne)
router.delete("/:id", remove)

export default router
