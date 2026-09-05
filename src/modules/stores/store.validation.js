import { AppError } from "../../shared/errors/AppError.js"

function optionalString(body, key, { max = 500 } = {}) {
  if (body[key] === undefined || body[key] === null) return undefined
  if (typeof body[key] !== "string") {
    throw new AppError(`${key} must be a string`, 400)
  }
  const trimmed = body[key].trim()
  if (trimmed.length > max) throw new AppError(`${key} is too long`, 400)
  return trimmed
}

function optionalBool(body, key) {
  if (body[key] === undefined) return undefined
  return Boolean(body[key])
}

function optionalNumber(body, key, { min = 0, max = 100000 } = {}) {
  if (body[key] === undefined || body[key] === null || body[key] === "") {
    return undefined
  }
  const value = Number(body[key])
  if (Number.isNaN(value) || value < min || value > max) {
    throw new AppError(`${key} must be a number between ${min} and ${max}`, 400)
  }
  return value
}

export function parsePatchStore(body) {
  return {
    name: optionalString(body, "name"),
    legal_name: optionalString(body, "legal_name"),
    owner_name: optionalString(body, "owner_name"),
    address: optionalString(body, "address"),
    city: optionalString(body, "city"),
    contact_email: optionalString(body, "contact_email"),
    contact_phone: optionalString(body, "contact_phone"),
    logo_url: optionalString(body, "logo_url", { max: 2000 }),
    favicon_url: optionalString(body, "favicon_url", { max: 2000 }),
    currency: optionalString(body, "currency", { max: 16 }),
    timezone: optionalString(body, "timezone", { max: 64 }),
    ntn: optionalString(body, "ntn"),
    strn: optionalString(body, "strn"),
    fbr_invoice_enabled: optionalBool(body, "fbr_invoice_enabled"),
    charge_tax_on_sales: optionalBool(body, "charge_tax_on_sales"),
    default_tax_rate: optionalNumber(body, "default_tax_rate", { min: 0, max: 100 }),
    expiry_warning_days: optionalNumber(body, "expiry_warning_days", {
      min: 0,
      max: 365,
    }),
    expiry_critical_days: optionalNumber(body, "expiry_critical_days", {
      min: 0,
      max: 365,
    }),
    receipt_footer: optionalString(body, "receipt_footer", { max: 20000 }),
    pos_enabled: optionalBool(body, "pos_enabled"),
    web_enabled: optionalBool(body, "web_enabled"),
    is_live: optionalBool(body, "is_live"),
  }
}

const THEME_BUTTON_KEYS = [
  "btn_filled_bg",
  "btn_filled_text",
  "btn_filled_hover",
  "btn_outline_border",
  "btn_outline_text",
  "btn_outline_hover",
  "btn_text_color",
  "btn_text_hover",
]

export function parsePutTheme(body) {
  const primary = optionalString(body, "primary")
  const secondary = optionalString(body, "secondary")
  const accent = optionalString(body, "accent")
  if (!primary || !secondary || !accent) {
    throw new AppError("primary, secondary, and accent are required", 400)
  }
  const fields = { primary, secondary, accent }
  for (const key of THEME_BUTTON_KEYS) {
    if (body[key] !== undefined) {
      fields[key] = optionalString(body, key, { max: 64 }) ?? null
    }
  }
  return fields
}

const CONTENT_KEYS = [
  "about_title",
  "about_body",
  "about_mission",
  "about_vision",
  "contact_title",
  "contact_body",
  "homepage_headline",
  "homepage_subheadline",
  "footer_text",
  "faq_body",
  "shipping_body",
  "terms_body",
  "privacy_body",
]

export function parsePutContent(body) {
  const fields = {}
  for (const key of CONTENT_KEYS) {
    if (body[key] === undefined) continue
    if (body[key] === null) {
      fields[key] = null
      continue
    }
    fields[key] = optionalString(body, key, { max: 20000 })
  }
  return fields
}

export function parsePutShipping(body) {
  if (body.flat_fee === undefined) {
    throw new AppError("flat_fee is required", 400)
  }
  const flat_fee = Number(body.flat_fee)
  if (Number.isNaN(flat_fee) || flat_fee < 0) {
    throw new AppError("flat_fee must be a number >= 0", 400)
  }
  let free_over_amount = null
  if (body.free_over_amount !== undefined && body.free_over_amount !== null) {
    free_over_amount = Number(body.free_over_amount)
    if (Number.isNaN(free_over_amount) || free_over_amount < 0) {
      throw new AppError("free_over_amount must be a number >= 0", 400)
    }
  }
  return { flat_fee, free_over_amount }
}
