import { Router } from "express"
import {
  getPublicBanners,
  getPublicContent,
  getPublicProduct,
  getPublicProductReviews,
  getPublicShipping,
  getPublicTheme,
  listPublicCategories,
  listPublicProducts,
} from "./publicCatalog.controller.js"

const router = Router()

router.get("/stores/:slug/theme", getPublicTheme)
router.get("/stores/:slug/content", getPublicContent)
router.get("/stores/:slug/shipping", getPublicShipping)
router.get("/stores/:slug/banners", getPublicBanners)
router.get("/stores/:slug/categories", listPublicCategories)
router.get("/stores/:slug/products", listPublicProducts)
router.get("/stores/:slug/products/:id/reviews", getPublicProductReviews)
router.get("/stores/:slug/products/:id", getPublicProduct)

export default router
