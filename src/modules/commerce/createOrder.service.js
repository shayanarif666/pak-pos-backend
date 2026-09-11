import { UniqueConstraintError } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { ORDER_CHANNEL, PAYMENT_METHOD } from "../../db/enums.js"
import { Order } from "../orders/order.model.js"
import { OrderItem } from "../orders/orderItem.model.js"
import { Payment } from "../payments/payment.model.js"
import { Receipt } from "../payments/receipt.model.js"
import { CouponRedemption } from "../coupons/couponRedemption.model.js"
import { Product } from "../catalog/product.model.js"
import { Category } from "../catalog/category.model.js"
import { getStoreForManager } from "../stores/store.service.js"
import { getLocation } from "../locations/location.service.js"
import { Customer } from "../customers/customer.model.js"
import { getCustomer, recordLedgerEntry } from "../customers/customer.service.js"
import {
  computeCouponDiscount,
  couponBlockReason,
  findCouponByCode,
} from "../coupons/coupon.service.js"
import { nextOrderNumber, nextReceiptNumber } from "../../shared/utils/counter.util.js"
import { assertPlan } from "../../shared/utils/plan.util.js"
import { writeAudit } from "../../shared/utils/audit.util.js"
import { AppError } from "../../shared/errors/AppError.js"
import { ConflictError } from "../../shared/errors/ConflictError.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"
import {
  applySessionSale,
  requireOpenSession,
} from "../pos/registerSession.service.js"
import { deductSaleStock } from "./stock.service.js"
import {
  lineTaxAmount,
  loadBulkTiers,
  loadPricingContext,
  money,
  priceCatalogLine,
  priceCustomLine,
  applyDiscount,
  quoteOrderTotals,
} from "./pricing.service.js"

export function publicOrder(order, extras = {}) {
  const json = order.toJSON ? order.toJSON() : order
  const gross_amount = json.gross_amount == null ? null : Number(json.gross_amount)
  const line_discount_amount =
    json.line_discount_amount == null ? null : Number(json.line_discount_amount)
  const subtotal = Number(json.subtotal)
  const order_discount = Number(json.discount_amount || 0)
  const coupon_discount = Number(json.coupon_discount_amount || 0)
  const tax_amount = Number(json.tax_amount)
  return {
    id: json.id,
    store_id: json.store_id,
    store_number: json.store_id_int ?? json.store_number ?? null,
    location_id: json.location_id,
    location_number: json.location_id_int ?? json.location_number ?? null,
    channel: json.channel,
    is_custom: json.is_custom,
    order_number: json.order_number,
    cashier_id: json.cashier_id,
    customer_id: json.customer_id,
    register_session_id: json.register_session_id,
    client_local_id: json.client_local_id,
    gross_amount: gross_amount ?? subtotal,
    line_discount_amount: line_discount_amount ?? 0,
    subtotal,
    is_order_discounted: json.is_order_discounted,
    order_discount_type: json.order_discount_type,
    discount_amount: order_discount,
    coupon_id: json.coupon_id,
    coupon_code: json.coupon_code,
    coupon_discount_amount: coupon_discount,
    tax_amount,
    shipping_fee: Number(json.shipping_fee),
    total_amount: Number(json.total_amount),
    cost_total: Number(json.cost_total),
    payment_method: json.payment_method,
    payment_status: json.payment_status,
    order_status: json.order_status,
    void_reason: json.void_reason || null,
    cancel_reason: json.cancel_reason || null,
    amount_paid: Number(json.amount_paid),
    change_due: json.change_due == null ? null : Number(json.change_due),
    shipping_address: json.shipping_address,
    placed_at: json.placed_at,
    ...extras,
  }
}

export function publicOrderItem(item) {
  const json = item.toJSON ? item.toJSON() : item
  const quantity = Number(json.quantity)
  const unit_price = Number(json.unit_price)
  const discount_amount = Number(json.discount_amount || 0)
  const after_discount = Number(json.subtotal)
  const tax_amount = Number(json.tax_amount || 0)
  const list_amount = money(unit_price * quantity)
  return {
    id: json.id,
    order_id: json.order_id,
    product_id: json.product_id,
    title: json.title,
    sku: json.sku,
    barcode: json.barcode,
    unit: json.unit,
    is_weight_based: json.is_weight_based,
    weight: json.weight == null ? null : Number(json.weight),
    qty_packs: json.qty_packs == null ? null : Number(json.qty_packs),
    quantity,
    unit_price,
    cost_price: Number(json.cost_price || 0),
    list_amount,
    discount_amount,
    after_discount,
    tax_amount,
    line_total: money(after_discount + tax_amount),
    refunded_qty: Number(json.refunded_qty || 0),
    remaining_qty: money(Math.max(0, quantity - Number(json.refunded_qty || 0))),
    pricing_source: json.pricing_source || null,
  }
}

async function loadExisting(storeId, clientLocalId, transaction) {
  if (!clientLocalId) return null
  return Order.findOne({
    where: { store_id: storeId, client_local_id: clientLocalId },
    include: [OrderItem, Payment],
    transaction,
  })
}

async function orderView(order, transaction) {
  const items = order.OrderItems ||
    (await OrderItem.findAll({ where: { order_id: order.id }, transaction }))
  const payments = order.Payments ||
    (await Payment.findAll({ where: { order_id: order.id }, transaction }))
  const receipt =
    order.Receipt ||
    (await Receipt.findOne({ where: { order_id: order.id }, transaction }))
  return {
    order: publicOrder(order),
    items: items.map(publicOrderItem),
    payments,
    receipt,
    idempotent: true,
  }
}

function resolveOrderDiscount(subtotal, input) {
  if (input.order_discount_type && input.order_discount_value != null) {
    return applyDiscount(
      subtotal,
      input.order_discount_type,
      input.order_discount_value
    )
  }
  if (input.discount_amount != null && input.order_discount_type) {
    return money(Math.min(subtotal, Number(input.discount_amount)))
  }
  return 0
}

function normalizeClientLocalId(value) {
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

function resolveSaleLocation(actor, store, session) {
  return session?.location_id || actor.location_id || store.default_location_id
}

export async function createOrder(actor, input) {
  const channel = String(input.channel || "")
  if (!ORDER_CHANNEL.includes(channel)) {
    throw new AppError("channel must be web or pos", 400)
  }

  const items = Array.isArray(input.items) ? input.items : []
  if (!items.length) throw new AppError("items are required", 400)

  const is_custom = Boolean(input.is_custom)
  const client_local_id = normalizeClientLocalId(input.client_local_id)
  const store = await getStoreForManager(actor.store_id)
  if (client_local_id) await assertPlan(store, "offline_enabled")

  return sequelize.transaction(async (transaction) => {
    const existing = await loadExisting(store.id, client_local_id, transaction)
    if (existing) return { ...(await orderView(existing, transaction)), idempotent: true }

    let session = null
    if (channel === "pos") {
      session = await requireOpenSession(
        store.id,
        {
          locationId: actor.location_id || store.default_location_id,
          deviceId: input.device_id,
          sessionId: input.register_session_id,
        },
        { transaction }
      )
    }

    const locationId = resolveSaleLocation(actor, store, session)
    if (!is_custom && !locationId) {
      throw new AppError("location_id is required to deduct stock", 400)
    }
    if (channel === "pos" && !locationId) {
      throw new AppError("location_id is required for POS sales", 400)
    }
    const location = locationId
      ? await getLocation(store.id, locationId)
      : null

    const now = new Date()
    const { offers, taxRates, shippingRule } = await loadPricingContext(store.id, {
      locationId: location?.id,
      now,
    })

    const productIds = items
      .map((item) => item.product_id)
      .filter(Boolean)
    const products = productIds.length
      ? await Product.findAll({
          where: { id: productIds, store_id: store.id },
          include: [Category],
          transaction,
        })
      : []
    const productMap = new Map(products.map((row) => [row.id, row]))
    const bulkTiers = await loadBulkTiers(store.id, productIds)
    const tiersByProduct = new Map()
    for (const tier of bulkTiers) {
      const list = tiersByProduct.get(tier.product_id) || []
      list.push(tier)
      tiersByProduct.set(tier.product_id, list)
    }

    const priced = items.map((item) => {
      if (is_custom && !item.product_id) {
        if (!item.title) throw new AppError("Custom lines require a title", 400)
        if (item.unit_price == null) {
          throw new AppError("Custom lines require unit_price", 400)
        }
        const line = priceCustomLine(item)
        line.tax_amount = input.tax_exempt
          ? 0
          : lineTaxAmount(store, null, null, line.subtotal)
        return line
      }
      const product = productMap.get(item.product_id)
      if (!product) throw new NotFoundError("Product not found")
      if (!product.is_active) throw new AppError("Product is not active", 400)
      const line = priceCatalogLine({
        product,
        quantity: item.quantity,
        weight: item.weight,
        offers,
        bulkTiers: tiersByProduct.get(product.id) || [],
        locationId: location?.id,
        now,
      })
      line.tax_amount = input.tax_exempt
        ? 0
        : lineTaxAmount(
            store,
            product,
            product.Category,
            line.subtotal
          )
      return line
    })

    const lineSubtotal = money(
      priced.reduce((sum, line) => sum + Number(line.subtotal), 0)
    )
    const orderDiscount = resolveOrderDiscount(lineSubtotal, input)
    if (!input.tax_exempt && orderDiscount > 0 && lineSubtotal > 0) {
      const taxableShare = money((lineSubtotal - orderDiscount) / lineSubtotal)
      for (const line of priced) {
        if (!line.product_id) {
          line.tax_amount = lineTaxAmount(
            store,
            null,
            null,
            money(Number(line.subtotal) * taxableShare)
          )
          continue
        }
        const product = productMap.get(line.product_id)
        line.tax_amount = lineTaxAmount(
          store,
          product,
          product?.Category,
          money(Number(line.subtotal) * taxableShare)
        )
      }
    }

    let coupon = null
    let couponDiscount = 0
    if (input.coupon_code) {
      coupon = await findCouponByCode(store.id, input.coupon_code)
      if (!coupon) throw new AppError("Coupon not found", 400)
      const reason = couponBlockReason(coupon, {
        order_total: money(lineSubtotal - orderDiscount),
        channel,
        location_id: location?.id,
        now,
      })
      if (reason) throw new AppError(reason, 400)
      couponDiscount = computeCouponDiscount(
        coupon,
        money(lineSubtotal - orderDiscount)
      )
    }

    const paymentSplits = Array.isArray(input.payments)
      ? input.payments.filter((row) => row && row.method)
      : []
    for (const row of paymentSplits) {
      if (!PAYMENT_METHOD.includes(row.method) || row.method === "mixed") {
        throw new AppError("Invalid payment method", 400)
      }
    }

    const payment_method =
      paymentSplits.length > 1
        ? "mixed"
        : paymentSplits[0]?.method || input.payment_method
    if (!PAYMENT_METHOD.includes(payment_method)) {
      throw new AppError("payment_method is required", 400)
    }

    const totals = quoteOrderTotals({
      lines: priced,
      store,
      channel,
      shippingRule,
      couponDiscount,
      orderDiscount,
      paymentMethod: payment_method,
      paymentSplits: paymentSplits.length ? paymentSplits : null,
      taxRates,
      taxExempt: Boolean(input.tax_exempt),
    })

    let customer = null
    if (input.customer_id) {
      customer = await getCustomer(store.id, input.customer_id)
    } else if (actor.role === "customer") {
      customer = await Customer.findOne({
        where: { store_id: store.id, user_id: actor.id },
        transaction,
      })
      if (!customer) throw new AppError("Customer profile not found", 400)
    }

    const order_number = await nextOrderNumber(store.id, transaction)
    const cashier_id =
      input.cashier_id ||
      (["cashier", "manager", "store_admin"].includes(actor.role) ? actor.id : null)

    let order
    try {
      order = await Order.create(
        {
          store_id: store.id,
          store_id_int: store.store_id_int,
          location_id: location?.id || null,
          location_id_int: location?.location_id_int || null,
          channel,
          is_custom,
          order_number,
          cashier_id,
          customer_id: customer?.id || null,
          register_session_id: session?.id || null,
          client_local_id,
          gross_amount: totals.gross_amount,
          line_discount_amount: totals.line_discount_amount,
          subtotal: totals.subtotal,
          is_order_discounted: orderDiscount > 0,
          order_discount_type: orderDiscount > 0 ? input.order_discount_type : null,
          discount_amount: totals.discount_amount,
          coupon_id: coupon?.id || null,
          coupon_code: coupon?.code || null,
          coupon_discount_amount: totals.coupon_discount_amount,
          tax_amount: totals.tax_amount,
          shipping_fee: totals.shipping_fee,
          total_amount: totals.total_amount,
          cost_total: totals.cost_total,
          payment_method,
          payment_status: "paid",
          shipping_address: channel === "web" ? input.shipping_address || null : null,
          order_status: "completed",
          amount_paid: 0,
          change_due: null,
          placed_at: now,
        },
        { transaction }
      )
    } catch (err) {
      if (err instanceof UniqueConstraintError && client_local_id) {
        const replay = await loadExisting(store.id, client_local_id, transaction)
        if (replay) return { ...(await orderView(replay, transaction)), idempotent: true }
        throw new ConflictError("Duplicate order")
      }
      throw err
    }

    const savedItems = await OrderItem.bulkCreate(
      priced.map((line) => ({
        order_id: order.id,
        product_id: line.product_id,
        title: line.title,
        sku: line.sku,
        barcode: line.barcode,
        unit: line.unit,
        is_weight_based: line.is_weight_based,
        weight: line.weight,
        qty_packs: line.qty_packs,
        unit_price: line.unit_price,
        cost_price: line.cost_price,
        quantity: line.quantity,
        discount_amount: line.discount_amount,
        tax_amount: line.tax_amount,
        subtotal: line.subtotal,
      })),
      { transaction }
    )

    for (const line of priced) {
      if (!line.product_id) continue
      await deductSaleStock(
        {
          store,
          location,
          productId: line.product_id,
          qty: line.quantity,
          staffId: cashier_id,
          orderId: order.id,
          isCustom: is_custom,
        },
        { transaction }
      )
    }

    const plannedPayments = paymentSplits.length
      ? paymentSplits
      : [{ method: payment_method, amount: totals.total_amount }]

    const paidSum = money(
      plannedPayments.reduce((sum, row) => sum + Number(row.amount || 0), 0)
    )
    const tendered = money(input.amount_paid != null ? input.amount_paid : paidSum)
    const collected = money(Math.max(paidSum, tendered))
    let creditAmount = money(totals.total_amount - collected)
    if (creditAmount < 0) creditAmount = 0
    if (creditAmount > 0 && !customer) {
      throw new AppError("A customer is required for credit / udhaar", 400)
    }

    const payments = []
    for (const row of plannedPayments) {
      const amount = money(row.amount)
      if (amount <= 0) throw new AppError("payment amount must be > 0", 400)
      const tax_amount = money(
        totals.gst * (paidSum > 0 ? amount / paidSum : 1)
      )
      const payment = await Payment.create(
        {
          store_id: store.id,
          store_id_int: store.store_id_int,
          location_id: location?.id || null,
          location_id_int: location?.location_id_int || null,
          order_id: order.id,
          method: row.method,
          amount,
          tax_amount,
          currency: store.currency || "PKR",
          status: "success",
          paid_at: now,
        },
        { transaction }
      )
      payments.push(payment)
    }

    if (creditAmount > 0) {
      await recordLedgerEntry(
        customer,
        {
          entry_type: "debit",
          amount: creditAmount,
          order_id: order.id,
          created_by: actor.id,
          note: `Order #${order_number}`,
        },
        { transaction }
      )
    }

    const amount_paid = tendered
    const change_due =
      amount_paid > totals.total_amount
        ? money(amount_paid - totals.total_amount)
        : 0

    const receipt_number = await nextReceiptNumber(store.id, transaction)
    const receipt = await Receipt.create(
      {
        store_id: store.id,
        store_id_int: store.store_id_int,
        location_id: location?.id || null,
        location_id_int: location?.location_id_int || null,
        order_id: order.id,
        payment_id: payments[0]?.id || null,
        receipt_number,
        cashier_id,
        subtotal: totals.subtotal,
        discount_amount: money(totals.discount_amount + totals.coupon_discount_amount),
        tax_amount: totals.tax_amount,
        shipping_fee: totals.shipping_fee,
        total_amount: totals.total_amount,
        issued_at: now,
      },
      { transaction }
    )

    if (coupon && couponDiscount > 0) {
      await CouponRedemption.create(
        {
          store_id: store.id,
          coupon_id: coupon.id,
          order_id: order.id,
          user_id: actor.role === "customer" ? actor.id : null,
          amount: couponDiscount,
        },
        { transaction }
      )
      await coupon.update(
        { used_count: Number(coupon.used_count) + 1 },
        { transaction }
      )
    }

    await order.update(
      { amount_paid, change_due },
      { transaction }
    )

    if (session) {
      await applySessionSale(
        session,
        { payments, total: totals.total_amount },
        { transaction }
      )
    }

    await writeAudit({
      action: "sale",
      entity_type: "orders",
      entity_id: order.id,
      store_id: store.id,
      store_id_int: store.store_id_int,
      location_id: location?.id || null,
      location_id_int: location?.location_id_int || null,
      user_id: actor.id,
      channel,
      note: `#${order_number}`,
      after_data: {
        order_number,
        total_amount: totals.total_amount,
        payment_method,
        channel,
      },
    })

    const cashier = actor
      ? {
          id: actor.id,
          name: actor.name,
          email: actor.email,
          phone: actor.phone,
          role: actor.role,
        }
      : null
    const customerLite = customer
      ? {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
        }
      : null

    return {
      order: publicOrder(order, {
        amount_paid,
        change_due,
        cashier,
        customer: customerLite,
      }),
      items: savedItems.map((row, index) =>
        publicOrderItem({
          ...(row.toJSON ? row.toJSON() : row),
          pricing_source: priced[index]?.pricing_source || null,
        })
      ),
      payments,
      receipt,
      customer: customerLite,
      idempotent: false,
    }
  })
}
