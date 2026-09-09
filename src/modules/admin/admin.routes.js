import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import {
  applyCloudinaryImages,
  uploadImageFields,
} from "../../shared/middlewares/upload.middleware.js"
import {
  parseAdminDevice,
  parseCreateLicense,
  parsePatchLicense,
  parsePatchStore,
  parseRegisterStore,
  parseRegisterSuperAdmin,
  parseBulkDelete,
  parseRevoke,
} from "./admin.validation.js"
import {
  bulkDeleteModule,
  createDevice,
  createLicense,
  deleteAllDbData,
  deleteModuleAll,
  deleteModuleById,
  getLicense,
  getStore,
  listDataModules,
  listDevices,
  listLicenses,
  listStores,
  patchLicense,
  patchStore,
  registerStore,
  registerSuperAdmin,
  renewLicense,
  revokeLicense,
} from "./admin.controller.js"
import { adminBillingRoutes } from "../billings/billing.routes.js"
import { listAdmin } from "../audit/audit.controller.js"

const router = Router()

router.post(
  "/superadmins",
  validate(parseRegisterSuperAdmin),
  registerSuperAdmin
)

router.use(authMiddleware, authorize("superadmin"))

const storeImages = [
  uploadImageFields([
    { name: "logo", maxCount: 1 },
    { name: "favicon", maxCount: 1 },
  ]),
  applyCloudinaryImages([
    { fileField: "logo", bodyField: "logo_url", kind: "logos" },
    { fileField: "favicon", bodyField: "favicon_url", kind: "favicons" },
  ]),
]

router.post(
  "/stores",
  ...storeImages,
  validate(parseRegisterStore),
  registerStore
)
router.get("/stores", listStores)
router.get("/stores/:id", getStore)
router.patch("/stores/:id", ...storeImages, validate(parsePatchStore), patchStore)

router.post("/licenses", validate(parseCreateLicense), createLicense)
router.get("/licenses", listLicenses)
router.get("/licenses/:id", getLicense)
router.patch("/licenses/:id", validate(parsePatchLicense), patchLicense)
router.post("/licenses/:id/revoke", validate(parseRevoke), revokeLicense)
router.post("/licenses/:id/renew", renewLicense)

router.post("/pos-devices", validate(parseAdminDevice), createDevice)
router.get("/pos-devices", listDevices)

router.get("/audit-logs", listAdmin)
router.use("/billings", adminBillingRoutes)

router.get("/data/modules", listDataModules)
router.delete("/data", deleteAllDbData)
router.delete("/data/:module", deleteModuleAll)
router.post("/data/:module/bulk-delete", validate(parseBulkDelete), bulkDeleteModule)
router.delete("/data/:module/:id", deleteModuleById)

export default router
