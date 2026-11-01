import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import { getStoreForManager } from "../stores/store.service.js"
import { bulkStatus, posBulkResponse, extractBulkItems, runBulk } from "../../shared/utils/bulk.util.js"
import { parseCreateProduct, parsePatchProduct, parseWeightPatch } from "./product.validation.js"
import { Product } from "./product.model.js"
import { Category } from "./category.model.js"
import { parseCatalogVisibility } from "../../db/channelVisibility.js"
import { AppError } from "../../shared/errors/AppError.js"
import {
  bulkUpdateResponse,
  pickFields,
  requireBoolean,
  runBulkUpdate,
  uuidOfNumber,
} from "../../shared/utils/bulkUpdate.util.js"
import { posProduct, posProducts } from "../pos/posResponses.js"
import * as productService from "./product.service.js"
import { uploadImageBuffer } from "../../shared/utils/cloudinary.util.js"
import * as posHistory from "../pos/posHistory.service.js"

export const list = asyncHandler(async (req, res) => {
  if (req.auth?.channel === "pos") return posHistory.sendPage(res, await posHistory.products(req))
  // A variant is listed inside its product (variants[] with their own stock).
  const data = await productService.listProducts(req.user, req.query, { parentsOnly: true })
  return apiResponse(res, 200, "OK", data)
})

export const getOne = asyncHandler(async (req, res) => {
  const pos = req.auth?.channel === "pos"
  const data = await productService.getProductView(req.user, req.params.id, req.query, { withSummary: !pos })
  if (!pos) return apiResponse(res, 200, "OK", data)
  // The POS shape, with the stock per location (each variant's inside it), as in Products.
  const [row] = await posProducts([data])
  const stocks = data.stocks || []
  return apiResponse(res, 200, "OK", {
    ...row,
    qty: Number(stocks.reduce((sum, stock) => sum + Number(stock.qty || 0), 0).toFixed(3)),
    stocks: stocks.map((stock) => ({
      location: { id: stock.location_number, name: stock.location_name || null },
      qty: stock.qty,
      expiry_date: stock.expiry_date,
    })),
  })
})

export const create = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const product = await productService.createProduct(store, req.body, req.user)
  if (req.auth?.channel === "pos") {
    // Every field, with short numbers (id = product_number, category_id = category_number).
    return apiResponse(res, 201, "Products Created", await posProduct(product))
  }
  return apiResponse(res, 201, "Product created", product)
})

export const createBulk = asyncHandler(async (req, res) => {
  const store = await getStoreForManager(req.storeId)
  const data = await runBulk(extractBulkItems(req.body), async (item) => {
    return productService.createProduct(store, parseCreateProduct(item), req.user)
  })
  if (req.auth?.channel === "pos") {
    const created = []
    created.push(...(await posProducts(data.created)))
    return posBulkResponse(res, data, "Products Created", created)
  }
  return apiResponse(res, bulkStatus(data), "Bulk products processed", data)
})

export const patch = asyncHandler(async (req, res) => {
  const product = await productService.updateProduct(
    req.storeId,
    req.params.id,
    req.body,
    req.user
  )
  return apiResponse(res, 200, "Product updated", product)
})

export const remove = asyncHandler(async (req, res) => {
  const product = await productService.deleteProduct(req.storeId, req.params.id)
  return apiResponse(res, 200, "Product disabled", product)
})

// ---- Product image (one per product): upload, read, remove ----

/** POST /products/image (productId + image file) or POST /products/:id/image (image file). */
export const uploadImage = asyncHandler(async (req, res) => {
  const ref = req.params.id ?? req.body?.productId ?? req.body?.product_id
  if (!req.file) throw new AppError("Send the image file in the image field", 400)
  // Check the product first, so a wrong id never uploads a file.
  await productService.getProductByRef(req.storeId, ref)
  const result = await uploadImageBuffer(req.file.buffer, {
    folder: `pak-pos/${req.storeId}/products`,
    filename: req.file.originalname,
  })
  const data = await productService.setProductImage(req.storeId, ref, result.secure_url)
  return apiResponse(res, 200, "Product Image Uploaded", data)
})

export const getImage = asyncHandler(async (req, res) => {
  return apiResponse(res, 200, "OK", await productService.getProductImage(req.storeId, req.params.id))
})

export const removeImage = asyncHandler(async (req, res) => {
  return apiResponse(res, 200, "Product Image Removed", await productService.setProductImage(req.storeId, req.params.id, null))
})

export const listWeight = asyncHandler(async (req, res) => {
  if (req.auth?.channel === "pos") return posHistory.sendPage(res, await posHistory.weightList(req))
  const data = await productService.listWeightProducts(req.storeId)
  return apiResponse(res, 200, "OK", data)
})

export const patchWeight = asyncHandler(async (req, res) => {
  const data = await productService.patchWeight(req.storeId, req.params.id, req.body)
  return apiResponse(res, 200, "Weight setting updated", data)
})

export const listExpiry = asyncHandler(async (req, res) => {
  if (req.auth?.channel === "pos") return posHistory.sendPage(res, await posHistory.expiryList(req))
  // A manager sees their own location; a store admin every location (or ?location_id=).
  const locationId =
    req.user.role === "store_admin" ? req.query.location_id || null : req.auth?.location_id || req.user.location_id
  const data = await productService.listExpiryProducts(req.storeId, locationId)
  return apiResponse(res, 200, "OK", data)
})

export const listBulkTiers = asyncHandler(async (req, res) => {
  const data = await productService.listBulkTiers(req.storeId, req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const putBulkTiers = asyncHandler(async (req, res) => {
  const data = await productService.replaceBulkTiers(
    req.storeId,
    req.params.id,
    req.body.tiers
  )
  return apiResponse(res, 200, "Bulk tiers saved", data)
})

// ---- Bulk updates (POS offline sync): items[] = [{ id (product number), ...fields }] ----

async function withCategoryRef(storeId, fields) {
  if (fields.category_id === undefined) return fields
  return {
    ...fields,
    category_id: await uuidOfNumber(Category, "category_number", storeId, fields.category_id, "Category"),
  }
}

function bulkProductUpdate(parse, message) {
  return asyncHandler(async (req, res) => {
    const data = await runBulkUpdate(req.body, {
      model: Product,
      column: "product_number",
      label: "Product",
      storeId: req.storeId,
      handler: async (uuid, fields) =>
        productService.updateProduct(
          req.storeId,
          uuid,
          parse(await withCategoryRef(req.storeId, fields)),
          req.user
        ),
    })
    const rows = req.auth?.channel === "pos" ? await posProducts(data.created) : data.created
    return bulkUpdateResponse(res, data, message, rows)
  })
}

const PRICE_FIELDS = ["selling_price", "cost_price", "pack_selling_price", "pack_cost_price"]

/** PATCH /products/bulk — any product field, as in create (only what is sent changes). */
export const patchBulk = bulkProductUpdate((fields) => {
  const patch = parsePatchProduct(fields)
  if (!Object.keys(patch).length) throw new AppError("No fields to update", 400)
  return patch
}, "Products Updated")

/** PATCH /products/bulk/weight — { id, is_weight_based }. */
export const patchBulkWeight = bulkProductUpdate(parseWeightPatch, "Weight Settings Updated")

/** PATCH /products/bulk/price — { id, selling_price?, cost_price?, pack_selling_price?, pack_cost_price? }. */
export const patchBulkPrice = bulkProductUpdate(
  (fields) => pickFields(parsePatchProduct(fields), PRICE_FIELDS, "price"),
  "Prices Updated"
)

/** PATCH /products/bulk/status — { id, is_active }: false hides it from sale, the record stays. */
export const patchBulkStatus = bulkProductUpdate(
  (fields) => ({ is_active: requireBoolean(fields, "is_active") }),
  "Product Status Updated"
)

/** PATCH /products/bulk/visibility — { id, is_pos_visible?, is_web_visible? }. */
export const patchBulkVisibility = bulkProductUpdate((fields) => {
  const visibility = parseCatalogVisibility(fields, { patch: true })
  if (!Object.keys(visibility).length) {
    throw new AppError("visibility: send is_pos_visible and / or is_web_visible", 400)
  }
  return visibility
}, "Product Visibility Updated")
