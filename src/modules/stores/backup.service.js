import fs from "fs/promises"
import path from "path"
import { sequelize } from "../../db/sequelize.js"
import { StoreBackup } from "./storeBackup.model.js"
import { StoreTheme } from "./storeTheme.model.js"
import { WebsiteContent } from "./websiteContent.model.js"
import { ShippingRule } from "./shippingRule.model.js"
import { PaymentMethodTaxRate } from "./paymentMethodTaxRate.model.js"
import { StoreBanner } from "./storeBanner.model.js"
import { Location } from "../locations/location.model.js"
import { getStoreForManager, publicStore } from "./store.service.js"
import { assertPlan } from "../../shared/utils/plan.util.js"
import { writeAudit } from "../../shared/utils/audit.util.js"
import { uploadRawBuffer } from "../../shared/utils/cloudinary.util.js"
import { NotFoundError } from "../../shared/errors/NotFoundError.js"

const STORE_RESTORE_FIELDS = [
  "name",
  "legal_name",
  "owner_name",
  "address",
  "city",
  "contact_email",
  "contact_phone",
  "logo_url",
  "favicon_url",
  "currency",
  "timezone",
  "ntn",
  "strn",
  "fbr_invoice_enabled",
  "charge_tax_on_sales",
  "default_tax_rate",
  "expiry_warning_days",
  "expiry_critical_days",
  "receipt_footer",
]

function backupDir(storeId) {
  return path.join(process.cwd(), "storage", "backups", storeId)
}

function backupPath(storeId, id) {
  return path.join(backupDir(storeId), `${id}.json`)
}

async function readBackupFile(fileUrl) {
  if (/^https?:\/\//i.test(fileUrl)) {
    const res = await fetch(fileUrl)
    if (!res.ok) return null
    return res.text()
  }
  return fs.readFile(fileUrl, "utf8").catch(() => null)
}

async function requireBackupEnabled(store) {
  return assertPlan(store, "backup_restore_enabled")
}

async function buildSnapshot(store) {
  const [theme, content, shipping, tax_rates, banners, locations] =
    await Promise.all([
      StoreTheme.findOne({ where: { store_id: store.id } }),
      WebsiteContent.findOne({ where: { store_id: store.id } }),
      ShippingRule.findOne({ where: { store_id: store.id } }),
      PaymentMethodTaxRate.findAll({ where: { store_id: store.id } }),
      StoreBanner.findAll({ where: { store_id: store.id } }),
      Location.findAll({ where: { store_id: store.id } }),
    ])

  return {
    version: 1,
    created_at: new Date().toISOString(),
    store: publicStore(store),
    theme,
    content,
    shipping,
    tax_rates,
    banners,
    locations,
  }
}

export async function listBackups(storeId) {
  const store = await getStoreForManager(storeId)
  await requireBackupEnabled(store)
  return StoreBackup.findAll({
    where: { store_id: storeId },
    order: [["created_at", "DESC"]],
  })
}

export async function createBackup(storeId, input, user) {
  const store = await getStoreForManager(storeId)
  await requireBackupEnabled(store)

  const snapshot = await buildSnapshot(store)
  const row = await StoreBackup.create({
    store_id: store.id,
    note: input.note,
    created_by: user.id,
  })

  const payload = JSON.stringify(snapshot, null, 2)
  let file_url
  try {
    const uploaded = await uploadRawBuffer(Buffer.from(payload, "utf8"), {
      folder: `pak-pos/${store.id}/backups`,
      filename: `${row.id}.json`,
    })
    file_url = uploaded.secure_url
  } catch {
    await fs.mkdir(backupDir(store.id), { recursive: true })
    file_url = backupPath(store.id, row.id)
    await fs.writeFile(file_url, payload, "utf8")
  }
  await row.update({ file_url })

  await writeAudit({
    action: "backup",
    entity_type: "store_backups",
    entity_id: row.id,
    store_id: store.id,
    store_id_int: store.store_id_int,
    user_id: user.id,
  })

  return row
}

async function loadBackupRow(id, storeId) {
  const where = { id }
  if (storeId) where.store_id = storeId
  const row = await StoreBackup.findOne({ where })
  if (!row) throw new NotFoundError("Backup not found")
  return row
}

export async function restoreBackup(id, user) {
  const storeId = user.role === "superadmin" ? null : user.store_id
  const row = await loadBackupRow(id, storeId)
  const store = await getStoreForManager(row.store_id)
  await requireBackupEnabled(store)

  if (!row.file_url) throw new NotFoundError("Backup file is missing")
  const raw = await readBackupFile(row.file_url)
  if (!raw) throw new NotFoundError("Backup file is missing")
  const snapshot = JSON.parse(raw)

  await sequelize.transaction(async (transaction) => {
    if (snapshot.store) {
      const patch = {}
      for (const key of STORE_RESTORE_FIELDS) {
        if (snapshot.store[key] !== undefined) patch[key] = snapshot.store[key]
      }
      await store.update(patch, { transaction })
    }

    if (snapshot.theme) {
      const theme = await StoreTheme.findOne({
        where: { store_id: store.id },
        transaction,
      })
      const fields = { ...snapshot.theme }
      delete fields.id
      delete fields.store_id
      delete fields.store_id_int
      delete fields.created_at
      delete fields.updated_at
      if (theme) await theme.update(fields, { transaction })
      else {
        await StoreTheme.create(
          { store_id: store.id, store_id_int: store.store_id_int, ...fields },
          { transaction }
        )
      }
    }

    if (snapshot.content) {
      const content = await WebsiteContent.findOne({
        where: { store_id: store.id },
        transaction,
      })
      const fields = { ...snapshot.content }
      delete fields.id
      delete fields.store_id
      delete fields.store_id_int
      delete fields.created_at
      delete fields.updated_at
      if (content) await content.update(fields, { transaction })
    }

    if (snapshot.shipping) {
      const shipping = await ShippingRule.findOne({
        where: { store_id: store.id },
        transaction,
      })
      const fields = { ...snapshot.shipping }
      delete fields.id
      delete fields.store_id
      delete fields.store_id_int
      delete fields.created_at
      delete fields.updated_at
      if (shipping) await shipping.update(fields, { transaction })
    }

    if (Array.isArray(snapshot.tax_rates)) {
      for (const rate of snapshot.tax_rates) {
        const existing = await PaymentMethodTaxRate.findOne({
          where: { store_id: store.id, payment_method: rate.payment_method },
          transaction,
        })
        if (existing) {
          await existing.update({ gst_percent: rate.gst_percent }, { transaction })
        }
      }
    }

    if (Array.isArray(snapshot.banners)) {
      await StoreBanner.destroy({ where: { store_id: store.id }, transaction })
      for (const banner of snapshot.banners) {
        await StoreBanner.create(
          {
            store_id: store.id,
            store_id_int: store.store_id_int,
            image_url: banner.image_url,
            heading: banner.heading,
            link_url: banner.link_url,
            sort_order: banner.sort_order,
            is_active: banner.is_active,
          },
          { transaction }
        )
      }
    }

    if (Array.isArray(snapshot.locations)) {
      for (const loc of snapshot.locations) {
        const existing = await Location.findOne({
          where: {
            store_id: store.id,
            location_id_int: loc.location_id_int,
          },
          transaction,
        })
        if (!existing) continue
        await existing.update(
          {
            name: loc.name,
            address_line: loc.address_line,
            city: loc.city,
            postal_code: loc.postal_code,
            phone: loc.phone,
            is_active: loc.is_active,
          },
          { transaction }
        )
      }
    }
  })

  await writeAudit({
    action: "restore",
    entity_type: "store_backups",
    entity_id: row.id,
    store_id: store.id,
    store_id_int: store.store_id_int,
    user_id: user.id,
  })

  return { id: row.id, store_id: store.id, restored: true }
}
