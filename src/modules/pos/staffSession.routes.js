import { Router } from "express"
import { bulkDelete } from "../../shared/utils/bulkDelete.util.js"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import { requestScope } from "../../shared/middlewares/requestScope.middleware.js"
import {
  requireTenantStore,
  tenantMiddleware,
} from "../../shared/middlewares/tenant.middleware.js"
import { clockIn, clockOut, getOne, patchBulk, patchOne, list, remove } from "./staffSession.controller.js"
import { bulkPatch } from "../../shared/middlewares/bulkPatch.middleware.js"

const router = Router()

// Only a store admin or manager holds a token; they clock in themselves or the cashier picked by PIN.
// PATCH /bulk takes the body of its POST (storeId, items[] with the POST field names).
const PATCH_BODY = bulkPatch()

router.use(authMiddleware, authorize("store_admin", "manager"), tenantMiddleware, requireTenantStore)

router.get("/", list)
// Each item is one staff member (id / staff_id); a staff_id sent once on top fills the rest.
const clockScope = requestScope({ staffKeys: ["staff_id", "staffId", "id"] })
router.post("/clock-in", clockScope, clockIn)
router.post("/clock-out", clockScope, clockOut)
// A manager corrects attendance: items[] = [{ id (session number), clock_in_at?, clock_out_at? }].
router.patch("/bulk", ...PATCH_BODY, patchBulk)
// One session (session number or UUID): read it, edit its times, or soft delete it.
router.get("/:id", getOne)
router.patch("/:id", patchOne)
// The bulk form of the delete below (as POST / PATCH /bulk): { storeId, items: [{ id }] }, each item that delete.
router.delete("/bulk", bulkDelete(remove, "Staff Sessions Deleted"))
router.delete("/:id", remove)

export default router
