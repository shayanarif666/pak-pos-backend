/*
 * Pay In / Pay Out (cash movements): cash put into or taken out of a till's drawer by hand. Each
 * movement belongs to a batch (the drawer of one shift) when one is found; the batch's cash_in /
 * cash_out and expected cash follow every create, edit and delete (applySessionCash).
 */
import { sequelize } from "../../db/sequelize.js"
import { CashMovement } from "./cashMovement.model.js"
import { RegisterSession } from "./registerSession.model.js"
import { PosDevice } from "./posDevice.model.js"
import { User } from "../auth/user.model.js"
import { Supplier } from "../inventory/supplier.model.js"
import { Customer } from "../customers/customer.model.js"
import { Location } from "../locations/location.model.js"
import { applySessionCash, findSaleSession } from "./registerSession.service.js"
import { Refs } from "./posResponses.js"
import { nextCashMovementNumber } from "../../shared/utils/counter.util.js"
import { writeAudit } from "../../shared/utils/audit.util.js"
import { AppError } from "../../shared/errors/AppError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

const isNumber = (ref) => /^[0-9]+$/.test(String(ref))
const BRANCH_ROLES = new Set(["manager", "cashier"])

async function byRef(model, column, storeId, ref, label, transaction) {
  if (ref == null) return null
  const row = await model.findOne({
    where: { store_id: storeId, ...(isNumber(ref) ? { [column]: Number(ref) } : { id: ref }) },
    attributes: ["id"],
    transaction,
  })
  if (!row) throw new NotFoundError(`${label} ${ref} not found`)
  return row.id
}

const userOf = (storeId, ref, label, transaction) => byRef(User, "user_number", storeId, ref, label, transaction)

const PARTY_MODELS = {
  supplier: [Supplier, "supplier_number", "Supplier"],
  customer: [Customer, "customer_number", "Customer"],
  staff: [User, "user_number", "Staff member"],
}

/** party_id is the supplier / customer / staff number of party_type; "other" (or none) takes a name only. */
async function partyOf(storeId, type, ref, transaction) {
  if (ref == null) return null
  const entry = PARTY_MODELS[type]
  if (!entry) throw new AppError("party_id needs party_type supplier, customer or staff", 400)
  return byRef(entry[0], entry[1], storeId, ref, entry[2], transaction)
}

async function deviceOf(storeId, ref, transaction) {
  if (ref == null) return null
  const row = await PosDevice.findOne({
    where: { store_id: storeId, ...(isNumber(ref) ? { device_number: Number(ref) } : { id: ref }) },
    attributes: ["id", "location_id"],
    transaction,
  })
  if (!row) throw new NotFoundError(`Device ${ref} not found`)
  return row
}

async function batchOf(storeId, ref, transaction) {
  if (ref == null) return null
  const row = await RegisterSession.findOne({
    where: { store_id: storeId, deleted_at: null, ...(isNumber(ref) ? { session_number: Number(ref) } : { id: ref }) },
    transaction,
  })
  if (!row) throw new NotFoundError(`Batch ${ref} not found`)
  return row
}

async function locationRow(storeId, id, transaction) {
  const row = id ? await Location.findOne({ where: { id, store_id: storeId }, attributes: ["id", "location_id_int"], transaction }) : null
  if (row) return row
  // No location named and none on the token (a store admin): the store's default location.
  const fallback = await Location.findOne({
    where: { store_id: storeId, is_default: true },
    attributes: ["id", "location_id_int"],
    transaction,
  }) || (await Location.findOne({ where: { store_id: storeId }, attributes: ["id", "location_id_int"], order: [["location_id_int", "ASC"]], transaction }))
  if (!fallback) throw new AppError("The store has no location", 400)
  return fallback
}

// ---------------------------------------------------------------- reading

/** The users, locations, batches, devices and parties the rows point at. */
export function cashRefs(rows) {
  const parties = (type) => rows.filter((row) => row.party_type === type).map((row) => row.party_id)
  return new Refs().loadAll({
    user: rows.flatMap((row) => [row.staff_id, row.from_user, row.to_user, ...(row.party_type === "staff" ? [row.party_id] : [])]),
    location: rows.map((row) => row.location_id),
    batch: rows.map((row) => row.batch_id),
    device: rows.map((row) => row.device_id),
    supplier: parties("supplier"),
    customer: parties("customer"),
  })
}

function partyView(row, refs) {
  if (!row.party_type && !row.party_name) return null
  let id = null
  let name = row.party_name || null
  if (row.party_id) {
    const kind = row.party_type === "staff" ? "user" : row.party_type
    const found = refs.get(kind, row.party_id)
    if (found) {
      id = refs.number(kind, row.party_id)
      name = name || found.name
    }
  }
  return { type: row.party_type || "other", id, name }
}

/** A row of the cash movement lists and replies: every reference as { id (its number), name… }. */
export function publicCashMovement(row, refs) {
  const batch = row.batch_id ? refs.get("batch", row.batch_id) : null
  return {
    id: row.movement_number,
    type: row.type,
    amount: Number(row.amount),
    reason: row.reason,
    location: refs.location(row.location_id),
    batch: batch ? { id: batch.session_number, status: batch.status } : null,
    device_id: refs.number("device", row.device_id),
    staff: refs.staff(row.staff_id),
    party: partyView(row, refs),
    from_user: refs.staff(row.from_user),
    to_user: refs.staff(row.to_user),
    occurred_at: row.occurred_at,
    attachment_url: row.attachment_url,
    local_id: row.client_local_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

async function viewOf(id) {
  const row = await CashMovement.findByPk(id)
  return publicCashMovement(row, await cashRefs([row]))
}

/** A movement by its number or UUID; a manager / cashier only finds their own location's. */
export async function findCashMovement(actor, ref, transaction) {
  const row = await CashMovement.findOne({
    where: {
      store_id: actor.store_id,
      deleted_at: null,
      ...(isNumber(ref) ? { movement_number: Number(ref) } : { id: String(ref) }),
      ...(BRANCH_ROLES.has(actor.role) && actor.location_id ? { location_id: actor.location_id } : {}),
    },
    transaction,
  })
  if (!row) throw new NotFoundError("Cash movement not found")
  return row
}

// ---------------------------------------------------------------- writing

function audit(actor, row, action, note) {
  return writeAudit({
    action,
    entity_type: "cash_movements",
    entity_id: row.id,
    store_id: row.store_id,
    store_id_int: row.store_id_int,
    location_id: row.location_id,
    location_id_int: row.location_id_int,
    user_id: actor.id,
    channel: "web",
    note,
  })
}

const label = (row) => `${row.type === "pay_in" ? "pay in" : "pay out"} #${row.movement_number} Rs ${Number(row.amount)}`

/**
 * POST /cash-movements(/bulk): one Pay In / Pay Out. The batch: the one sent (batch number), else the
 * open batch of the device / staff member at the location (at occurred_at for an offline one); none =
 * saved without a batch. The same local_id sent again returns the saved movement.
 */
export async function createCashMovement(store, actor, input) {
  if (input.client_local_id) {
    const existing = await CashMovement.findOne({ where: { store_id: store.id, client_local_id: input.client_local_id } })
    if (existing) return { view: await viewOf(existing.id), idempotent: true }
  }
  const id = await sequelize.transaction(async (transaction) => {
    const staffId = input.staff_id ? await userOf(store.id, input.staff_id, "Staff member", transaction) : actor.id
    const device = await deviceOf(store.id, input.device_id, transaction)
    let batch = await batchOf(store.id, input.batch_id, transaction)
    const occurredAt = input.occurred_at || new Date()
    const location = await locationRow(store.id, input.location_id || batch?.location_id || actor.location_id || device?.location_id, transaction)
    if (!batch) {
      batch = await findSaleSession(
        store.id,
        { locationId: location.id, deviceId: device?.id, cashierId: staffId, placedAt: occurredAt, offline: occurredAt.getTime() < Date.now() - 60000 },
        { transaction }
      )
    }
    const row = await CashMovement.create(
      {
        store_id: store.id,
        store_id_int: store.store_id_int,
        movement_number: await nextCashMovementNumber(store.id, transaction),
        location_id: location.id,
        location_id_int: location.location_id_int,
        batch_id: batch?.id || null,
        device_id: device?.id || null,
        staff_id: staffId,
        type: input.type,
        reason: input.reason,
        amount: input.amount,
        party_type: input.party_type ?? (input.party_name ? "other" : null),
        party_id: await partyOf(store.id, input.party_type, input.party_id ?? null, transaction),
        party_name: input.party_name ?? null,
        from_user: await userOf(store.id, input.from_user ?? null, "from_user", transaction),
        to_user: await userOf(store.id, input.to_user ?? null, "to_user", transaction),
        occurred_at: occurredAt,
        attachment_url: input.attachment_url ?? null,
        client_local_id: input.client_local_id ?? null,
      },
      { transaction }
    )
    await applySessionCash(row.batch_id, { type: row.type, amount: row.amount }, { transaction })
    return row.id
  })
  const row = await CashMovement.findByPk(id)
  await audit(actor, row, "create", `${label(row)} added`)
  return { view: await viewOf(id), idempotent: false }
}

/** PATCH: only what is sent changes; the batch's cash moves with it (off the old batch, onto the new one). */
export async function updateCashMovement(actor, ref, input) {
  const found = await findCashMovement(actor, ref)
  await sequelize.transaction(async (transaction) => {
    const row = await CashMovement.findByPk(found.id, { transaction, lock: transaction.LOCK.UPDATE })
    const storeId = row.store_id
    const patch = {}
    for (const key of ["type", "amount", "reason", "occurred_at", "attachment_url", "party_name"]) {
      if (input[key] !== undefined) patch[key] = input[key]
    }
    if (input.staff_id !== undefined) patch.staff_id = input.staff_id ? await userOf(storeId, input.staff_id, "Staff member", transaction) : null
    if (input.from_user !== undefined) patch.from_user = await userOf(storeId, input.from_user, "from_user", transaction)
    if (input.to_user !== undefined) patch.to_user = await userOf(storeId, input.to_user, "to_user", transaction)
    if (input.device_id !== undefined) patch.device_id = (await deviceOf(storeId, input.device_id, transaction))?.id || null
    if (input.batch_id !== undefined) {
      const batch = await batchOf(storeId, input.batch_id, transaction)
      patch.batch_id = batch?.id || null
      if (batch) Object.assign(patch, { location_id: batch.location_id, location_id_int: batch.location_id_int })
    }
    if (input.party_type !== undefined || input.party_id !== undefined) {
      const type = input.party_type !== undefined ? input.party_type : row.party_type
      const partyRef = input.party_id !== undefined ? input.party_id : input.party_type !== undefined && input.party_type !== row.party_type ? null : undefined
      patch.party_type = type
      if (partyRef !== undefined) patch.party_id = await partyOf(storeId, type, partyRef, transaction)
    }
    // The old figures off the old batch, the new ones onto the (maybe new) batch.
    await applySessionCash(row.batch_id, { type: row.type, amount: row.amount, reverse: true }, { transaction })
    await row.update(patch, { transaction })
    await applySessionCash(row.batch_id, { type: row.type, amount: row.amount }, { transaction })
  })
  const row = await CashMovement.findByPk(found.id)
  await audit(actor, row, "update", `${label(row)} edited`)
  return viewOf(found.id)
}

/** DELETE: soft delete — the movement leaves the lists and its cash comes off its batch; the row stays. */
export async function deleteCashMovement(actor, ref) {
  const found = await findCashMovement(actor, ref)
  await sequelize.transaction(async (transaction) => {
    const row = await CashMovement.findByPk(found.id, { transaction, lock: transaction.LOCK.UPDATE })
    await applySessionCash(row.batch_id, { type: row.type, amount: row.amount, reverse: true }, { transaction })
    await row.update({ deleted_at: new Date() }, { transaction })
  })
  await audit(actor, found, "delete", `${label(found)} deleted`)
  return { ...(await viewOf(found.id)), deleted_at: new Date() }
}
