import { findLiveStoreByDomain } from "../../modules/stores/store.service.js"
import { NotFoundError } from "../errors/NotFoundError.js"
import { AppError } from "../errors/AppError.js"

function hostOf(url) {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/**
 * Storefronts on their own domain (e.g. www.fatimastationers.com) call the API without a slug.
 * The store is resolved from, in order: ?domain=, X-Store-Domain header, Origin, Referer.
 * Sets req.storeSlug / req.publicStore for the public catalog controllers.
 */
export async function resolveStoreFromDomain(req, res, next) {
  try {
    const domain =
      req.query.domain ||
      req.get("x-store-domain") ||
      hostOf(req.get("origin")) ||
      hostOf(req.get("referer"))
    if (!domain) throw new AppError("domain is required", 400)

    const store = await findLiveStoreByDomain(domain)
    if (!store) throw new NotFoundError("Store not found")

    req.publicStore = store
    req.storeSlug = store.slug
    next()
  } catch (err) {
    next(err)
  }
}
