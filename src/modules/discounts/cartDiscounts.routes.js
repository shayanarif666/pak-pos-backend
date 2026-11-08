import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import { requireTenantStore, tenantMiddleware } from "../../shared/middlewares/tenant.middleware.js"
import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { scopeOf } from "../pos/posHistory.service.js"
import { cartDiscounts } from "./cartDiscounts.service.js"
import { refList } from "./discountParse.js"

const router = Router()
const tenant = [authMiddleware, tenantMiddleware, requireTenantStore]

/**
 * GET /order-discounts?product_ids=1,2&category_ids=3: every discount that touches the cart:
 * category, product, order, bundle and bulk. The order discount is global, so it needs no query.
 */
router.get(
  "/",
  ...tenant,
  authorize("store_admin", "manager", "cashier"),
  asyncHandler(async (req, res) => {
    const productRefs = refList(req.query.product_ids ?? req.query.productIds, "product_ids")
    const categoryRefs = refList(req.query.category_ids ?? req.query.categoryIds, "category_ids")
    const data = await cartDiscounts(await scopeOf(req), { productRefs, categoryRefs })
    return apiResponse(res, 200, "OK", data)
  })
)

export default router
