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

// Resend's HTTPS API: works where outbound SMTP ports are blocked (e.g. Render's free plan).
async function sendWithResend({ to, subject, text, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text, html }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`)
  }
}

export async function sendMail({ to, subject, text, html }) {
  if (env.RESEND_API_KEY) {
    if (!env.MAIL_FROM) {
      logger.warn("MAIL_FROM is not set; email was not sent", { to, subject })
      return { skipped: true }
    }
    try {
      await sendWithResend({ to, subject, text, html })
      return { skipped: false }
    } catch (err) {
      logger.error("Failed to send email", { to, subject, message: err.message })
      return { failed: true }
    }
  }

  if (!smtpReady()) {
    logger.warn("Email is not configured (RESEND_API_KEY or SMTP); email was not sent", { to, subject })
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
  const html = emailLayout(`
    <p style="margin:0 0 12px">Hi ${escapeHtml(name)},</p>
    <p style="margin:0 0 24px">We received a request to reset your password. The link works once and expires in 1 hour.</p>
    <p style="margin:0 0 24px">
      <a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#135c4c;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:10px">Reset password</a>
    </p>
    <p style="margin:0 0 6px;color:#64748b;font-size:13px">Or paste this token in the app:</p>
    <p style="margin:0 0 24px;font-family:monospace;font-size:13px;word-break:break-all;background:#f1f5f9;padding:10px;border-radius:8px">${escapeHtml(token)}</p>
    <p style="margin:0;color:#64748b;font-size:13px">If you did not ask for this, you can ignore this email — your password stays the same.</p>
  `)
  return sendMail({ to: user.email, subject, text, html })
}

/** Simple branded wrapper (inline styles: email clients drop <style>). */
function emailLayout(body) {
  return `
  <div style="background:#f8fafc;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#0f172a;font-size:15px;line-height:1.6">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
      <div style="background:#135c4c;height:6px"></div>
      <div style="padding:28px">${body}</div>
    </div>
  </div>`
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
  const html = emailLayout(`
    <p style="margin:0 0 12px">Hi ${escapeHtml(name)},</p>
    <p style="margin:0 0 12px">Your password was changed successfully, and you were signed out on every device.</p>
    <p style="margin:0;color:#64748b;font-size:13px">If you did not do this, reset your password again or contact the store admin.</p>
  `)
  return sendMail({ to: user.email, subject, text, html })
}
