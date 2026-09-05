import { Address } from "./address.model.js"
import { getStoreForManager } from "../stores/store.service.js"
import { AppError } from "../../shared/errors/AppError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

function publicAddress(row) {
  const json = row.toJSON ? row.toJSON() : row
  return {
    id: json.id,
    store_id: json.store_id,
    user_id: json.user_id,
    name: json.name,
    phone: json.phone,
    address_line: json.address_line,
    city: json.city,
    postal_code: json.postal_code,
    is_default: json.is_default,
    created_at: json.created_at,
    updated_at: json.updated_at,
  }
}

function assertCustomer(actor) {
  if (actor.role !== "customer") {
    throw new AppError("Addresses are only for web customers", 403)
  }
}

export function formatAddressSnapshot(address) {
  const parts = [
    address.name,
    address.phone,
    address.address_line,
    address.city,
    address.postal_code,
  ].filter(Boolean)
  return parts.join(", ")
}

async function getOwnAddress(actor, id) {
  const row = await Address.findOne({
    where: { id, store_id: actor.store_id, user_id: actor.id },
  })
  if (!row) throw new NotFoundError("Address not found")
  return row
}

export async function listAddresses(actor) {
  assertCustomer(actor)
  const rows = await Address.findAll({
    where: { store_id: actor.store_id, user_id: actor.id },
    order: [
      ["is_default", "DESC"],
      ["created_at", "DESC"],
    ],
  })
  return rows.map(publicAddress)
}

export async function getAddress(actor, id) {
  assertCustomer(actor)
  return publicAddress(await getOwnAddress(actor, id))
}

export async function createAddress(actor, fields) {
  assertCustomer(actor)
  const store = await getStoreForManager(actor.store_id)
  const count = await Address.count({
    where: { store_id: actor.store_id, user_id: actor.id },
  })
  const is_default = fields.is_default || count === 0
  if (is_default) {
    await Address.update(
      { is_default: false },
      { where: { store_id: actor.store_id, user_id: actor.id } }
    )
  }

  const row = await Address.create({
    store_id: store.id,
    store_id_int: store.store_id_int,
    user_id: actor.id,
    name: fields.name,
    phone: fields.phone,
    address_line: fields.address_line,
    city: fields.city,
    postal_code: fields.postal_code,
    is_default,
  })
  return publicAddress(row)
}

export async function updateAddress(actor, id, fields) {
  assertCustomer(actor)
  const row = await getOwnAddress(actor, id)
  if (fields.is_default) {
    await Address.update(
      { is_default: false },
      { where: { store_id: actor.store_id, user_id: actor.id } }
    )
  }
  await row.update(fields)
  return publicAddress(row)
}

export async function deleteAddress(actor, id) {
  assertCustomer(actor)
  const row = await getOwnAddress(actor, id)
  const wasDefault = row.is_default
  await row.destroy()
  if (wasDefault) {
    const next = await Address.findOne({
      where: { store_id: actor.store_id, user_id: actor.id },
      order: [["created_at", "DESC"]],
    })
    if (next) await next.update({ is_default: true })
  }
  return { deleted: true }
}

export async function resolveCheckoutAddress(actor, { addressId, shippingAddress }) {
  assertCustomer(actor)
  if (shippingAddress) return shippingAddress
  if (addressId) {
    const row = await getOwnAddress(actor, addressId)
    return formatAddressSnapshot(row)
  }
  const fallback = await Address.findOne({
    where: { store_id: actor.store_id, user_id: actor.id, is_default: true },
  })
  if (fallback) return formatAddressSnapshot(fallback)
  throw new AppError("shipping address is required", 400)
}
