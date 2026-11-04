import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import { requireTenantStore, tenantMiddleware } from "../../shared/middlewares/tenant.middleware.js"
import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { reportingOverview, reportingSection } from "./reporting.service.js"

/*
 * Dashboard reporting by plan (not in the endpoint docs yet).
 * Query: location (number | UUID | all), from, to (YYYY-MM-DD; default the last 7 days), channel.
 * GET /reporting           — the plan's reporting level and every card, locked or not.
 * GET /reporting/:section  — one card: summary + its lists paged (table, page, limit, search).
 */
// The signed-in user as the report builders take them (a manager: their own location).
function actorOf(req) {
  const user = req.user
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    store_id: req.auth?.store_id || user.store_id,
    store_id_int: user.store_id_int ?? req.auth?.store_number ?? null,
    location_id: user.role === "store_admin" ? req.auth?.location_id || user.location_id || null : user.location_id || null,
  }
}

const router = Router()
router.use(authMiddleware, tenantMiddleware, requireTenantStore, authorize("store_admin", "manager"))

router.get("/", asyncHandler(async (req, res) => apiResponse(res, 200, "OK", await reportingOverview(actorOf(req), req.query))))
router.get(
  "/:section",
  asyncHandler(async (req, res) => apiResponse(res, 200, "OK", await reportingSection(actorOf(req), req.params.section, req.query)))
)

export default router
