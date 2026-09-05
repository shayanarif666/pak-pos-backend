import { Op } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { Customer } from "./customer.model.js"
import { CustomerCreditEntry } from "./customerCreditEntry.model.js"
import { Location } from "../locations/location.model.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { AppError } from "../../shared/errors/AppError.js"

function publicCustomer(row) {
  return {
    id: row.id,
    store_id: row.store_id,
    location_id: row.location_id,
    user_id: row.user_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    credit_limit: row.credit_limit,
    credit_balance: Number(row.credit_balance),
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

async function resolveLocation(storeId, locationId) {
  if (!locationId) return null
  const location = await Location.findOne({
    where: { id: locationId, store_id: storeId },
  })
  if (!location) throw new NotFoundError("Location not found")
  return location.id
}

export async function listCustomers(storeId, query = {}) {
  const where = { store_id: storeId }
  if (query.q) {
    const q = `%${String(query.q).trim()}%`
    where[Op.or] = [
      { name: { [Op.like]: q } },
      { phone: { [Op.like]: q } },
      { email: { [Op.like]: q } },
    ]
  }
  const rows = await Customer.findAll({
    where,
    order: [["created_at", "DESC"]],
  })
  return rows.map(publicCustomer)
}

export async function getCustomer(storeId, id) {
  const row = await Customer.findOne({ where: { id, store_id: storeId } })
  if (!row) throw new NotFoundError("Customer not found")
  return row
}

export async function getCustomerView(storeId, id) {
  return publicCustomer(await getCustomer(storeId, id))
}

export async function createCustomer(store, fields) {
  const location_id = await resolveLocation(store.id, fields.location_id)
  const row = await Customer.create({
    store_id: store.id,
    store_id_int: store.store_id_int,
    location_id,
    name: fields.name,
    email: fields.email,
    phone: fields.phone,
    credit_limit: fields.credit_limit,
    credit_balance: 0,
    is_active: true,
  })
  return publicCustomer(row)
}

export async function updateCustomer(storeId, id, fields) {
  const row = await getCustomer(storeId, id)
  const patch = { ...fields }
  if (fields.location_id !== undefined) {
    patch.location_id = await resolveLocation(storeId, fields.location_id)
  }
  await row.update(patch)
  return publicCustomer(row)
}

async function syncCreditBalance(customer, { transaction }) {
  const entries = await CustomerCreditEntry.findAll({
    where: { customer_id: customer.id, store_id: customer.store_id },
    transaction,
  })
  const balance = entries.reduce((sum, entry) => {
    const amount = Number(entry.amount)
    return entry.entry_type === "debit" ? sum + amount : sum - amount
  }, 0)
  await customer.update({ credit_balance: balance }, { transaction })
  return balance
}

export async function listCredit(storeId, customerId) {
  await getCustomer(storeId, customerId)
  return CustomerCreditEntry.findAll({
    where: { store_id: storeId, customer_id: customerId },
    order: [["created_at", "DESC"]],
  })
}

export async function recordLedgerEntry(customer, fields, { transaction }) {
  const entry = await CustomerCreditEntry.create(
    {
      store_id: customer.store_id,
      customer_id: customer.id,
      order_id: fields.order_id || null,
      entry_type: fields.entry_type,
      amount: fields.amount,
      due_date: fields.due_date || null,
      note: fields.note || null,
      created_by: fields.created_by || null,
    },
    { transaction }
  )
  const credit_balance = await syncCreditBalance(customer, { transaction })
  return { entry, credit_balance }
}

export async function addCreditEntry(storeId, customerId, fields, actor) {
  const customer = await getCustomer(storeId, customerId)
  if (fields.amount <= 0) throw new AppError("amount must be > 0", 400)

  return sequelize.transaction(async (transaction) =>
    recordLedgerEntry(
      customer,
      {
        entry_type: fields.entry_type,
        amount: fields.amount,
        due_date: fields.due_date,
        note: fields.note,
        created_by: actor.id,
      },
      { transaction }
    )
  )
}
