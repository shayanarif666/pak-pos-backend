import { AppError } from "../../shared/errors/AppError.js"

function optionalText(body, key, max) {
  if (body[key] === undefined || body[key] === null) return undefined
  const value = String(body[key]).trim()
  if (!value || value.length > max) throw new AppError(`${key} must be 1–${max} characters`, 400)
  return value
}

// PUT /currency: send only what changes; the rest keeps its value (PKR defaults).
export function parsePutCurrency(body) {
  const fields = {}
  const code = optionalText(body, "code", 3)
  if (code !== undefined) {
    if (!/^[A-Za-z]{3}$/.test(code)) throw new AppError("code must be a 3-letter ISO code, e.g. PKR", 400)
    fields.code = code.toUpperCase()
  }
  const name = optionalText(body, "name", 64)
  if (name !== undefined) fields.name = name
  const symbol = optionalText(body, "symbol", 8)
  if (symbol !== undefined) fields.symbol = symbol
  if (body.decimal_places !== undefined && body.decimal_places !== null) {
    const places = Number(body.decimal_places)
    if (!Number.isInteger(places) || places < 0 || places > 4) {
      throw new AppError("decimal_places must be an integer 0–4", 400)
    }
    fields.decimal_places = places
  }
  if (body.symbol_position !== undefined && body.symbol_position !== null) {
    if (!["before", "after"].includes(body.symbol_position)) {
      throw new AppError("symbol_position must be before or after", 400)
    }
    fields.symbol_position = body.symbol_position
  }
  if (!Object.keys(fields).length) {
    throw new AppError("Send at least one of code, name, symbol, decimal_places, symbol_position", 400)
  }
  return fields
}
