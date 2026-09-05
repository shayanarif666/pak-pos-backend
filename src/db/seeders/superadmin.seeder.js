import { env } from "../../config/env.js"
import { User } from "../../modules/auth/user.model.js"
import { hashPassword } from "../../shared/utils/hash.util.js"
import { registerModels } from "../registerModels.js"
import { sequelize } from "../sequelize.js"

async function seed() {
  registerModels()
  await sequelize.authenticate()

  const email = env.SUPERADMIN_EMAIL.toLowerCase()
  const pin = env.SUPERADMIN_PIN || null
  const fields = {
    name: env.SUPERADMIN_NAME,
    email,
    password: await hashPassword(env.SUPERADMIN_PASSWORD),
    pin,
    role: "superadmin",
    store_id: null,
    store_id_int: null,
    location_id: null,
    location_id_int: null,
    is_verified: true,
    is_active: true,
    refresh_token_hash: null,
  }

  const existing = await User.findOne({
    where: { email, role: "superadmin" },
  })

  if (existing) {
    await existing.update(fields)
    console.log(`Super Admin updated: ${email}`)
  } else {
    await User.create(fields)
    console.log(`Super Admin created: ${email}`)
  }

  await sequelize.close()
}

seed().catch(async (err) => {
  console.error(err)
  await sequelize.close()
  process.exit(1)
})
