import nodemailer from "nodemailer"
import { env } from "../../config/env.js"
import { logger } from "../../config/logger.js"

function smtpReady() {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS)
}

function transporter() {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE || env.SMTP_PORT === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  })
}

export async function sendMail({ to, subject, text, html }) {
  if (!smtpReady()) {
    logger.warn("SMTP is not configured; email was not sent", { to, subject })
    return { skipped: true }
  }

  try {
    await transporter().sendMail({
      from: env.SMTP_FROM || env.SMTP_USER,
      to,
      subject,
      text,
      html,
    })
    return { skipped: false }
  } catch (err) {
    logger.error("Failed to send email", { to, subject, message: err.message })
    return { failed: true }
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

export async function sendPasswordResetEmail(user, token) {
  const resetUrl = `${env.FRONTEND_URL.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`
  const name = user.name || "there"
  const subject = "Reset your password"
  const text = [
    `Hi ${name},`,
    "",
    "We received a request to reset your password.",
    `Open this link (valid for 1 hour): ${resetUrl}`,
    "",
    `Or paste this token in the app: ${token}`,
    "",
    "If you did not ask for this, you can ignore this email.",
  ].join("\n")
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>We received a request to reset your password.</p>
    <p><a href="${escapeHtml(resetUrl)}">Reset your password</a> (valid for 1 hour).</p>
    <p>Or paste this token in the app:</p>
    <p><code>${escapeHtml(token)}</code></p>
    <p>If you did not ask for this, you can ignore this email.</p>
  `
  return sendMail({ to: user.email, subject, text, html })
}

export async function sendPasswordChangedEmail(user) {
  const name = user.name || "there"
  const subject = "Your password was changed"
  const text = [
    `Hi ${name},`,
    "",
    "Your password was changed successfully.",
    "If you did not do this, reset your password again or contact the store admin.",
  ].join("\n")
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Your password was changed successfully.</p>
    <p>If you did not do this, reset your password again or contact the store admin.</p>
  `
  return sendMail({ to: user.email, subject, text, html })
}
