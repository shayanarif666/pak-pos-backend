import { randomInt } from "node:crypto"
import { Op } from "sequelize"
import { Product } from "../../modules/catalog/product.model.js"

/** The EAN-13 check digit of the first 12 digits. */
export function ean13CheckDigit(first12) {
  const sum = [...first12].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return String((10 - (sum % 10)) % 10)
}

/** A random EAN-13 starting with 2 (the range shops use for their own, in-store barcodes). */
export function makeEan13() {
  let first12 = "2"
  while (first12.length < 12) first12 += String(randomInt(0, 10))
  return first12 + ean13CheckDigit(first12)
}

async function taken(storeId, barcode, excludeIds) {
  const row = await Product.findOne({
    where: { store_id: storeId, barcode, ...(excludeIds.length ? { id: { [Op.notIn]: excludeIds } } : {}) },
    attributes: ["id"],
  })
  return Boolean(row)
}

/**
 * The barcode to save: the one asked for when no other product of the store has it; otherwise a
 * new EAN-13 that no product has, so a create / update never fails on a barcode already in use.
 * Returns { barcode, replaced } — replaced = the requested one could not be used.
 */
export async function freeBarcode(storeId, requested, excludeIds = []) {
  const wanted = requested == null ? "" : String(requested).trim()
  const skip = excludeIds.filter(Boolean)
  if (wanted && !(await taken(storeId, wanted, skip))) return { barcode: wanted, replaced: false }
  for (let tries = 0; tries < 20; tries += 1) {
    const barcode = makeEan13()
    if (!(await taken(storeId, barcode, skip))) return { barcode, replaced: Boolean(wanted) }
  }
  throw new Error("Could not make a free barcode")
}
