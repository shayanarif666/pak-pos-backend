import { sequelize } from "../../db/sequelize.js"
import { Supplier } from "./supplier.model.js"
import { SupplierLedger } from "./supplierLedger.model.js"
import { Location } from "../locations/location.model.js"
import { getProduct } from "../catalog/product.service.js"
import {
  applyStockDelta,
  loadLocation,
} from "../catalog/productStock.service.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { AppError } from "../../shared/errors/AppError.js"

function publicSupplier(row, extras = {}) {
  return {
    id: row.id,
    store_id: row.store_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    payment_terms: row.payment_terms,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...extras,
  }
}

async function ledgerBalance(storeId, supplierId, transaction) {
  const rows = await SupplierLedger.findAll({
    where: { store_id: storeId, supplier_id: supplierId },
    transaction,
  })
  return rows.reduce((sum, row) => {
    const amount = Number(row.amount)
    return row.entry_type === "debit" ? sum + amount : sum - amount
  }, 0)
}

export async function listSuppliers(storeId) {
  const rows = await Supplier.findAll({
    where: { store_id: storeId },
    order: [["name", "ASC"]],
  })
  return rows.map((row) => publicSupplier(row))
}

export async function getSupplier(storeId, id) {
  const row = await Supplier.findOne({ where: { id, store_id: storeId } })
  if (!row) throw new NotFoundError("Supplier not found")
  return row
}

export async function getSupplierView(storeId, id) {
  const row = await getSupplier(storeId, id)
  const balance_owed = await ledgerBalance(storeId, id)
  return publicSupplier(row, { balance_owed })
}

export async function createSupplier(store, fields) {
  const row = await Supplier.create({
    store_id: store.id,
    store_id_int: store.store_id_int,
    name: fields.name,
    phone: fields.phone,
    email: fields.email,
    address: fields.address,
    payment_terms: fields.payment_terms,
    is_active: true,
  })
  return publicSupplier(row)
}

export async function updateSupplier(storeId, id, fields) {
  const row = await getSupplier(storeId, id)
  await row.update(fields)
  return publicSupplier(row)
}

export async function deactivateSupplier(storeId, id) {
  const row = await getSupplier(storeId, id)
  await row.update({ is_active: false })
  return publicSupplier(row)
}

export async function listLedger(storeId, supplierId) {
  await getSupplier(storeId, supplierId)
  return SupplierLedger.findAll({
    where: { store_id: storeId, supplier_id: supplierId },
    order: [["created_at", "DESC"]],
  })
}

export async function addLedgerEntry(store, supplierId, fields, actor) {
  const supplier = await getSupplier(store.id, supplierId)
  if (fields.location_id) {
    const location = await Location.findOne({
      where: { id: fields.location_id, store_id: store.id },
    })
    if (!location) throw new NotFoundError("Location not found")
  }

  return sequelize.transaction(async (transaction) => {
    let stock_movement_id = null
    if (fields.product_id && fields.qty) {
      if (!fields.location_id) {
        throw new AppError("location_id is required when recording stock", 400)
      }
      const product = await getProduct(store.id, fields.product_id)
      const location = await loadLocation(store.id, fields.location_id)
      const delta =
        fields.entry_type === "debit" ? Number(fields.qty) : -Number(fields.qty)
      const { movement } = await applyStockDelta(
        {
          storeId: store.id,
          storeIdInt: store.store_id_int,
          location,
          productId: product.id,
          delta,
          movement_type: delta > 0 ? "stock_in" : "stock_out",
          reason: delta > 0 ? "purchase" : "return_to_supplier",
          reason_note: fields.note,
          staff_id: actor.id,
          supplier_id: supplier.id,
        },
        { transaction }
      )
      stock_movement_id = movement?.id || null
    }

    const entry = await SupplierLedger.create(
      {
        store_id: store.id,
        store_id_int: store.store_id_int,
        location_id: fields.location_id,
        supplier_id: supplier.id,
        entry_type: fields.entry_type,
        amount: fields.amount,
        due_date: fields.due_date,
        paid_at: fields.entry_type === "credit" ? new Date() : null,
        stock_movement_id,
        note: fields.note,
        created_by: actor.id,
      },
      { transaction }
    )

    const balance_owed = await ledgerBalance(store.id, supplier.id, transaction)
    return { entry, balance_owed }
  })
}
