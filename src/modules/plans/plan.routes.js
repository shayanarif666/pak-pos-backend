import { Router } from "express"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import { authorize } from "../../shared/middlewares/authorize.middleware.js"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import { parseCreatePlan, parsePatchPlan } from "./plan.validation.js"
import { create, getOne, list, patch, remove } from "./plan.controller.js"

const router = Router()

router.use(authMiddleware, authorize("superadmin"))
router.get("/", list)
router.post("/", validate(parseCreatePlan), create)
router.get("/:id", getOne)
router.patch("/:id", validate(parsePatchPlan), patch)
router.delete("/:id", remove)

export default router
