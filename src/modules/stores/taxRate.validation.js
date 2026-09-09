import { AppError } from "../../shared/errors/AppError.js"
import { PAYMENT_METHOD } from "../../db/enums.js"

const TAX_METHODS = PAYMENT_METHOD.filter((method) => method !== "mixed")

function optionalString(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null
  return String(body[key]).trim()
}

export function parsePutTaxRates(body) {
  if (!Array.isArray(body.rates) || !body.rates.length) {
    throw new AppError("rates must be a non-empty array", 400)
  }

  const seen = new Set()
  const rates = body.rates.map((row, index) => {
    const payment_method = String(row?.payment_method || "").trim()
    if (!TAX_METHODS.includes(payment_method)) {
      throw new AppError(
        `rates[${index}].payment_method must be cash, card, jazzcash, easypaisa, or cod`,
        400
      )
    }
    if (seen.has(payment_method)) {
      throw new AppError(`Duplicate rate for ${payment_method}`, 400)
    }
    seen.add(payment_method)
    const gst_percent = Number(row.gst_percent)
    if (Number.isNaN(gst_percent) || gst_percent < 0 || gst_percent > 100) {
      throw new AppError(`rates[${index}].gst_percent must be 0–100`, 400)
    }
    return { payment_method, gst_percent }
  })

  const store = {}
  if (body.ntn !== undefined) store.ntn = optionalString(body, "ntn")
  if (body.strn !== undefined) store.strn = optionalString(body, "strn")
  if (body.charge_tax_on_sales !== undefined) {
    store.charge_tax_on_sales = Boolean(body.charge_tax_on_sales)
  }
  if (body.fbr_invoice_enabled !== undefined) {
    store.fbr_invoice_enabled = Boolean(body.fbr_invoice_enabled)
  }
  if (body.default_tax_rate !== undefined) {
    if (body.default_tax_rate === null || body.default_tax_rate === "") {
      store.default_tax_rate = null
    } else {
      const n = Number(body.default_tax_rate)
      if (Number.isNaN(n) || n < 0 || n > 100) {
        throw new AppError("default_tax_rate must be 0–100", 400)
      }
      store.default_tax_rate = n
    }
  }

  return { rates, store }
}
