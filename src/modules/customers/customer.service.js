import { Op } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { Customer } from "./customer.model.js"
import { CustomerCreditEntry } from "./customerCreditEntry.model.js"
import { Location } from "../locations/location.model.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import { AppError } from "../../shared/errors/AppError.js"

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100
}

const locationInclude = {
  model: Location,
  attributes: ["id", "name", "location_id_int"],
}

function publicCustomer(row) {
  const json = row.toJSON ? row.toJSON() : row
  return {
    id: json.id,
    store_id: json.store_id,
    store_number: json.store_id_int,
    location_id: json.location_id,
    location_number: json.Location?.location_id_int ?? null,
    user_id: json.user_id,
    name: json.name,
    email: json.email,
    phone: json.phone,
    total_debt: Number(json.total_debt || 0),
    remaining_debt: Number(json.remaining_debt || 0),
    debt_notes: json.debt_notes || null,
    is_active: json.is_active,
    created_at: json.created_at,
    updated_at: json.updated_at,
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
    include: [locationInclude],
    order: [["created_at", "DESC"]],
  })
  return rows.map(publicCustomer)
}

export async function getCustomer(storeId, id) {
  const row = await Customer.findOne({
    where: { id, store_id: storeId },
    include: [locationInclude],
  })
  if (!row) throw new NotFoundError("Customer not found")
  return row
}

export async function getCustomerView(storeId, id) {
  return publicCustomer(await getCustomer(storeId, id))
}

export async function createCustomer(store, fields) {
  const location_id = await resolveLocation(store.id, fields.location_id)
  const remaining =
    fields.remaining_debt == null
      ? fields.total_debt == null
        ? 0
        : Number(fields.total_debt)
      : Number(fields.remaining_debt)
  const total = fields.total_debt == null ? remaining : Number(fields.total_debt)
  if (remaining > total) {
    throw new AppError("remaining_debt cannot be greater than total_debt", 400)
  }
  const row = await Customer.create({
    store_id: store.id,
    store_id_int: store.store_id_int,
    location_id,
    name: fields.name,
    email: fields.email,
    phone: fields.phone,
    total_debt: 0,
    remaining_debt: 0,
    debt_notes: fields.debt_notes || null,
    is_active: true,
  })
  if (total > 0) {
    await sequelize.transaction(async (transaction) => {
      await recordLedgerEntry(
        row,
        {
          entry_type: "debit",
          amount: total,
          note: fields.debt_notes || "Opening total debt",
        },
        { transaction }
      )
      const paid = money(total - remaining)
      if (paid > 0) {
        await recordLedgerEntry(
          row,
          {
            entry_type: "credit",
            amount: paid,
            note: "Opening amount already paid",
          },
          { transaction }
        )
      }
    })
    await row.reload({ include: [locationInclude] })
  } else {
    await row.reload({ include: [locationInclude] })
  }
  return publicCustomer(row)
}

export async function updateCustomer(storeId, id, fields) {
  const row = await getCustomer(storeId, id)
  const patch = { ...fields }
  delete patch.total_debt
  delete patch.remaining_debt
  if (fields.location_id !== undefined) {
    patch.location_id = await resolveLocation(storeId, fields.location_id)
  }
  await row.update(patch)
  await row.reload({ include: [locationInclude] })
  return publicCustomer(row)
}

export async function listCredit(storeId, customerId) {
  await getCustomer(storeId, customerId)
  return CustomerCreditEntry.findAll({
    where: { store_id: storeId, customer_id: customerId },
    order: [["created_at", "DESC"]],
  })
}

async function syncCustomerDebt(customer, { transaction }) {
  const entries = await CustomerCreditEntry.findAll({
    where: { customer_id: customer.id, store_id: customer.store_id },
    transaction,
  })
  const total_debt = entries.reduce((sum, entry) => {
    return entry.entry_type === "debit" ? sum + Number(entry.amount || 0) : sum
  }, 0)
  const remaining_debt = entries.reduce((sum, entry) => {
    const amount = Number(entry.amount || 0)
    return entry.entry_type === "debit" ? sum + amount : sum - amount
  }, 0)
  await customer.update(
    {
      total_debt: Math.round(total_debt * 100) / 100,
      remaining_debt: Math.round(Math.max(0, remaining_debt) * 100) / 100,
    },
    { transaction }
  )
  return {
    total_debt: Number(customer.total_debt),
    remaining_debt: Number(customer.remaining_debt),
  }
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
  const debt = await syncCustomerDebt(customer, { transaction })
  return { entry, ...debt }
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
