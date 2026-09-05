import { Router } from "express"
import { validate } from "../../shared/middlewares/validate.middleware.js"
import { rateLimit } from "../../shared/middlewares/rateLimit.middleware.js"
import { authMiddleware } from "../../shared/middlewares/auth.middleware.js"
import {
  parseForgotPassword,
  parseLogin,
  parsePatchMe,
  parseRefresh,
  parseRegisterCustomer,
  parseResetPassword,
  parseVerifyEmail,
} from "./auth.validation.js"
import {
  forgotPassword,
  login,
  logout,
  me,
  patchMe,
  refresh,
  registerCustomer,
  resetPassword,
  verifyEmail,
} from "./auth.controller.js"

const router = Router()

router.post("/login", rateLimit({ max: 10 }), validate(parseLogin), login)
router.post("/refresh", validate(parseRefresh), refresh)
router.post("/logout", authMiddleware, logout)
router.get("/me", authMiddleware, me)
router.patch("/me", authMiddleware, validate(parsePatchMe), patchMe)
router.post(
  "/register-customer",
  rateLimit({ max: 8 }),
  validate(parseRegisterCustomer),
  registerCustomer
)
router.post(
  "/forgot-password",
  rateLimit({ max: 5 }),
  validate(parseForgotPassword),
  forgotPassword
)
router.post("/reset-password", validate(parseResetPassword), resetPassword)
router.post("/verify-email", validate(parseVerifyEmail), verifyEmail)

export default router
