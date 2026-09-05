import { sequelize } from "../../db/sequelize.js"
import { PaymentMethodTaxRate } from "./paymentMethodTaxRate.model.js"
import { getStoreForManager } from "./store.service.js"

function publicTax(row) {
  return {
    id: row.id,
    payment_method: row.payment_method,
    gst_percent: row.gst_percent,
  }
}

export async function getTaxRates(storeId) {
  const store = await getStoreForManager(storeId)
  const rates = await PaymentMethodTaxRate.findAll({
    where: { store_id: storeId },
    order: [["payment_method", "ASC"]],
  })
  return {
    ntn: store.ntn,
    strn: store.strn,
    charge_tax_on_sales: store.charge_tax_on_sales,
    fbr_invoice_enabled: store.fbr_invoice_enabled,
    rates: rates.map(publicTax),
  }
}

export async function putTaxRates(storeId, input) {
  const store = await getStoreForManager(storeId)

  await sequelize.transaction(async (transaction) => {
    if (Object.keys(input.store).length) {
      await store.update(input.store, { transaction })
    }

    for (const row of input.rates) {
      const existing = await PaymentMethodTaxRate.findOne({
        where: { store_id: storeId, payment_method: row.payment_method },
        transaction,
      })
      if (existing) {
        await existing.update({ gst_percent: row.gst_percent }, { transaction })
      } else {
        await PaymentMethodTaxRate.create(
          {
            store_id: store.id,
            store_id_int: store.store_id_int,
            payment_method: row.payment_method,
            gst_percent: row.gst_percent,
          },
          { transaction }
        )
      }
    }
  })

  return getTaxRates(storeId)
}
