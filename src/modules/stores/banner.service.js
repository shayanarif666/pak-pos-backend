import { StoreBanner } from "./storeBanner.model.js"
import { findLiveStoreBySlug } from "./store.service.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

export async function listBanners(storeId) {
  return StoreBanner.findAll({
    where: { store_id: storeId },
    order: [
      ["sort_order", "ASC"],
      ["created_at", "ASC"],
    ],
  })
}

export async function listPublicBanners(slug) {
  const store = await findLiveStoreBySlug(slug)
  if (!store) throw new NotFoundError("Store not found")
  return StoreBanner.findAll({
    where: { store_id: store.id, is_active: true },
    order: [
      ["sort_order", "ASC"],
      ["created_at", "ASC"],
    ],
  })
}

export async function createBanner(store, fields) {
  return StoreBanner.create({
    store_id: store.id,
    store_id_int: store.store_id_int,
    ...fields,
  })
}

export async function patchBanner(storeId, id, fields) {
  const banner = await StoreBanner.findOne({ where: { id, store_id: storeId } })
  if (!banner) throw new NotFoundError("Banner not found")
  await banner.update(fields)
  return banner
}

export async function deleteBanner(storeId, id) {
  const banner = await StoreBanner.findOne({ where: { id, store_id: storeId } })
  if (!banner) throw new NotFoundError("Banner not found")
  await banner.destroy()
  return null
}
