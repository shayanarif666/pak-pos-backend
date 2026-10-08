import { Router } from "express"
import { resolveStoreFromDomain } from "../../shared/middlewares/storeDomain.middleware.js"
import {
  getPublicBanners,
  getPublicContent,
  getPublicProduct,
  getPublicProductReviews,
  getPublicShipping,
  getPublicTheme,
  getSiteStore,
  listPublicCategories,
  listPublicPlans,
  listPublicProducts,
} from "./publicCatalog.controller.js"

const router = Router()

router.get("/plans", listPublicPlans)
router.get("/stores/:slug/theme", getPublicTheme)
router.get("/stores/:slug/content", getPublicContent)
router.get("/stores/:slug/shipping", getPublicShipping)
router.get("/stores/:slug/banners", getPublicBanners)
router.get("/stores/:slug/categories", listPublicCategories)
router.get("/stores/:slug/products", listPublicProducts)
router.get("/stores/:slug/products/:id/reviews", getPublicProductReviews)
router.get("/stores/:slug/products/:id", getPublicProduct)

// Same catalog for storefronts served on a custom domain (store resolved from the domain).
const site = Router()
site.get("/", getSiteStore)
site.get("/theme", getPublicTheme)
site.get("/content", getPublicContent)
site.get("/shipping", getPublicShipping)
site.get("/banners", getPublicBanners)
site.get("/categories", listPublicCategories)
site.get("/products", listPublicProducts)
site.get("/products/:id/reviews", getPublicProductReviews)
site.get("/products/:id", getPublicProduct)
router.get("/resolve", resolveStoreFromDomain, getSiteStore)
router.use("/site", resolveStoreFromDomain, site)

export default router
