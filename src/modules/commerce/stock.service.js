import { applyStockDelta } from "../catalog/productStock.service.js"

export async function deductSaleStock(
  {
    store,
    location,
    productId,
    qty,
    staffId,
    orderId,
    isCustom,
  },
  { transaction }
) {
  if (isCustom) return null
  return applyStockDelta(
    {
      storeId: store.id,
      storeIdInt: store.store_id_int,
      location,
      productId,
      delta: -Number(qty),
      movement_type: "sale",
      reason: "sale",
      staff_id: staffId || null,
      order_id: orderId,
    },
    { transaction }
  )
}

export async function restockSaleStock(
  {
    store,
    location,
    productId,
    qty,
    staffId,
    orderId,
    isCustom,
  },
  { transaction }
) {
  if (isCustom) return null
  return applyStockDelta(
    {
      storeId: store.id,
      storeIdInt: store.store_id_int,
      location,
      productId,
      delta: Number(qty),
      movement_type: "refund",
      reason: "refund",
      staff_id: staffId || null,
      order_id: orderId,
    },
    { transaction }
  )
}
