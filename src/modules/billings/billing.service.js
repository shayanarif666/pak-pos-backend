import { Billing } from "./billing.model.js"
import { Store } from "../stores/store.model.js"
import { Plan } from "../plans/plan.model.js"
import { BILLING_STATUS } from "../../db/enums.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { AppError } from "../../shared/errors/AppError.js"

function publicBilling(row) {
  if (!row) return null
  return {
    id: row.id,
    store_id: row.store_id,
    store_number: row.store_id_int,
    plan_id: row.plan_id,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    period_start: row.period_start,
    period_end: row.period_end,
    paid_at: row.paid_at,
    method_note: row.method_note,
    note: row.note,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function createBilling(fields, { transaction, createdBy } = {}) {
  const store = await Store.findByPk(fields.store_id, { transaction })
  if (!store) throw new NotFoundError("Store not found")

  const planId = fields.plan_id || store.plan_id
  const plan = await Plan.findByPk(planId, { transaction })
  if (!plan) throw new NotFoundError("Plan not found")

  const status = fields.status || "pending"
  if (!BILLING_STATUS.includes(status)) {
    throw new AppError("Invalid billing status", 400)
  }

  const paid_at =
    status === "paid" ? fields.paid_at || new Date() : fields.paid_at || null

  const row = await Billing.create(
    {
      store_id: store.id,
      store_id_int: store.store_id_int,
      plan_id: plan.id,
      amount: fields.amount ?? plan.price_pkr,
      currency: fields.currency || "PKR",
      status,
      period_start: fields.period_start,
      period_end: fields.period_end,
      paid_at,
      method_note: fields.method_note || null,
      note: fields.note || null,
      created_by: createdBy || null,
    },
    { transaction }
  )

  return publicBilling(row)
}

export async function listAllBillings(storeId) {
  const where = storeId ? { store_id: storeId } : {}
  const rows = await Billing.findAll({
    where,
    order: [["created_at", "DESC"]],
  })
  return rows.map(publicBilling)
}

export async function listStoreBillings(storeId) {
  return listAllBillings(storeId)
}

export async function updateBilling(id, fields) {
  const row = await Billing.findByPk(id)
  if (!row) throw new NotFoundError("Billing not found")

  const patch = {}
  if (fields.status !== undefined) {
    if (!BILLING_STATUS.includes(fields.status)) {
      throw new AppError("Invalid billing status", 400)
    }
    patch.status = fields.status
    if (fields.status === "paid" && !row.paid_at && fields.paid_at === undefined) {
      patch.paid_at = new Date()
    }
  }
  if (fields.paid_at !== undefined) patch.paid_at = fields.paid_at
  if (fields.method_note !== undefined) patch.method_note = fields.method_note
  if (fields.note !== undefined) patch.note = fields.note
  if (fields.amount !== undefined) patch.amount = fields.amount

  await row.update(patch)
  return publicBilling(row)
}

export { publicBilling }
